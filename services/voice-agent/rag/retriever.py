"""Query-time retrieval over the TRAVIS knowledge index.

``knowledge_search`` is the function the brain calls as a tool: it ensures the
index is current, embeds the query, cosine-ranks the chunks, and returns a
compact, spoken-friendly block of the top hits (with a source tag each).
"""

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from threading import Lock

import numpy as np

from rag import indexer
from rag.indexer import META_PATH, VECTORS_PATH

DEFAULT_K = 4
MIN_SCORE = 0.55  # cosine floor for a hit (nomic-embed-text: on-topic 0.59-0.77, off-topic <= 0.49)
MAX_CHARS = 1800  # cap on the combined block we hand back to the model

_lock = Lock()
_cache: dict | None = None  # {"hash": str, "vectors": np.ndarray, "chunks": list}


def _load_cache() -> dict | None:
    """Load vectors + meta into memory, refreshing if the index changed."""
    global _cache
    if not VECTORS_PATH.exists() or not META_PATH.exists():
        return None
    try:
        meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None

    file_hash = meta.get("corpus_hash")
    if _cache is not None and _cache.get("hash") == file_hash:
        return _cache

    with np.load(VECTORS_PATH) as data:
        vectors = np.asarray(data["vectors"], dtype=np.float32)
    _cache = {"hash": file_hash, "vectors": vectors, "chunks": meta.get("chunks", [])}
    return _cache


@lru_cache(maxsize=128)
def _embed_query(query_norm: str):
    """Embed one normalized query, cached — repeated questions skip the Ollama call. Query embeddings don't depend on the corpus, so no
    invalidation is needed on index rebuild. The cached ndarray is shared:
    treat it as read-only. lru_cache doesn't cache exceptions, so a transient
    API failure doesn't poison the cache.
    """
    return indexer.embed_texts([query_norm], "RETRIEVAL_QUERY")


@dataclass(frozen=True)
class Hit:
    chunk_id: str
    label: str  # "White Tusker: Clients"
    topic: str  # how Travis names the section aloud ("our clients")
    group: str
    text: str
    score: float


SECTION_MIN_SCORE = 0.5  # cosine floor for search(): nomic-embed-text scores on-topic sections 0.59+ and unrelated ones <= 0.49

# Every section of a one-company knowledge base mentions the company, so a query that names it ("white tusker projects") scores all
# sections alike and the embedding alone can rank the right one 7th of 8. A query word that is also a word of a section's own heading
# ("projects" / "Projects", "founded" / "Founders and leadership") is strong evidence, so it adds this much to that section's score.
HEADING_BOOST = 0.15
_WORDS = re.compile(r"[a-z0-9]+")
_FILLER = frozenset(
    "a an and are about at by can did do does for has have how i in is it its me more of on or our tell that the their them there they this to "
    "us we what when which who whom why will with you your please".split()
)


def _stems(text: str) -> set[str]:
    """Content words of `text`, cut to 5 letters so projects/project and founded/founders/founder meet."""
    return {w[:5] for w in _WORDS.findall((text or "").lower()) if w not in _FILLER and len(w) > 2}


def heading_match(query: str, chunk: dict) -> bool:
    """True when a content word of the query is a word of the section's heading or of the name Travis gives it aloud."""
    return bool(_stems(query) & _stems(f"{chunk.get('section', '')} {chunk.get('topic', '')}"))


def _chunks() -> list[dict]:
    with _lock:
        indexer.ensure_index()
        cache = _load_cache()
    return cache["chunks"] if cache else []


def search(query: str, groups: set[str] | None = None, exclude: set[str] | frozenset = frozenset(), k: int = 2,
           min_score: float = SECTION_MIN_SCORE, boost_groups: set[str] | None = None, boost: float = 0.0) -> list[Hit]:
    """The best `k` sections for `query`, best first: only those in `groups` (all if None), not in `exclude` (chunk ids already used), scoring
    at least `min_score`. Sections of `boost_groups` get `boost` added to their score: a hint (the planner's idea of the topic), not a filter, so a
    wrong hint can still be outranked by the right section. Raises if the index or the embedding model is unavailable (the caller says so aloud)."""
    query = " ".join((query or "").split())
    if not query:
        return []
    with _lock:
        indexer.ensure_index()
        cache = _load_cache()
    if not cache or cache["vectors"].shape[0] == 0:
        return []
    scores = cache["vectors"] @ _embed_query(query)[0]
    scores = scores + np.array([HEADING_BOOST if heading_match(query, c) else 0.0 for c in cache["chunks"]], dtype=np.float32)
    if boost_groups and boost:
        scores = scores + np.array([boost if c.get("group") in boost_groups else 0.0 for c in cache["chunks"]], dtype=np.float32)
    hits: list[Hit] = []
    for i in np.argsort(scores)[::-1]:
        c = cache["chunks"][int(i)]
        if scores[i] < min_score or len(hits) >= k:
            break
        if (groups and c.get("group") not in groups) or c["chunk_id"] in exclude:
            continue
        hits.append(Hit(c["chunk_id"], f"{c['title']}: {c.get('section', '')}".strip(": "), c.get("topic", ""), c.get("group", ""), c["text"], float(scores[i])))
    return hits


def sections(groups: set[str] | None = None) -> list[dict]:
    """Every section in the index (chunk_id, topic, group, label), optionally only those in `groups`."""
    return [
        {"chunk_id": c["chunk_id"], "topic": c.get("topic", ""), "group": c.get("group", ""), "label": f"{c['title']}: {c.get('section', '')}"}
        for c in _chunks()
        if not groups or c.get("group") in groups
    ]


def warm_index() -> None:
    """Build/refresh the index off the critical path (call from a background
    thread at startup). Takes the same lock as knowledge_search, so a
    concurrent first query can't double-build — it just waits.
    """
    with _lock:
        try:
            indexer.ensure_index()
        except Exception as e:
            print(f"[RAG] Warm build failed (first search will retry): {e}")


def knowledge_search(query: str, k: int = DEFAULT_K) -> str:
    """Retrieve the most relevant knowledge chunks for ``query``.

    Returns a labeled, spoken-friendly text block, or a clear no-results note so
    the model can say it doesn't have that information rather than guessing.
    """
    query = (query or "").strip()
    if not query:
        return "No search query was provided."

    with _lock:
        try:
            indexer.ensure_index()
        except Exception as e:
            return f"The knowledge base is unavailable right now ({e})."
        cache = _load_cache()

    if not cache or cache["vectors"].shape[0] == 0:
        return "The knowledge base is empty. No stored information to search."

    try:
        # Collapse whitespace: cache key and embedded text in one. (Not
        # lowercased — keep the embedded text byte-identical to what the
        # caller asked, casing carries little but nonzero signal.)
        q_vec = _embed_query(" ".join(query.split()))
    except Exception as e:
        return f"Could not search the knowledge base right now ({e})."
    if q_vec.shape[0] == 0:
        return "Could not search the knowledge base right now."

    scores = cache["vectors"] @ q_vec[0]
    k = max(1, min(k, scores.shape[0]))
    top_idx = np.argsort(scores)[::-1][:k]

    hits = [(int(i), float(scores[i])) for i in top_idx if scores[i] >= MIN_SCORE]
    if not hits:
        return (
            "No relevant information found in the knowledge base for that. "
            "Say you don't have that detail rather than guessing."
        )

    chunks = cache["chunks"]
    blocks, total = [], 0
    for i, _score in hits:
        chunk = chunks[i]
        block = f"[{chunk['source_label']}] {chunk['text'].strip()}"
        if total + len(block) > MAX_CHARS and blocks:
            break
        blocks.append(block)
        total += len(block)

    return "\n\n".join(blocks)
