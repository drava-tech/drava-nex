"""Query-time retrieval over the TRAVIS knowledge index.

``knowledge_search`` is the function the brain calls as a tool: it ensures the
index is current, embeds the query, cosine-ranks the chunks, and returns a
compact, spoken-friendly block of the top hits (with a source tag each).
"""

import json
from functools import lru_cache
from threading import Lock

import numpy as np

from rag import indexer
from rag.indexer import META_PATH, VECTORS_PATH

DEFAULT_K = 4
MIN_SCORE = 0.45  # cosine similarity floor for a hit to count as relevant
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
def _embed_query(query_norm: str, api_key: str | None):
    """Embed one normalized query, cached — repeated/similar questions skip
    the Gemini round-trip. Query embeddings don't depend on the corpus, so no
    invalidation is needed on index rebuild. The cached ndarray is shared:
    treat it as read-only. lru_cache doesn't cache exceptions, so a transient
    API failure doesn't poison the cache.
    """
    return indexer.embed_texts([query_norm], "RETRIEVAL_QUERY", api_key)


def warm_index(api_key: str | None = None) -> None:
    """Build/refresh the index off the critical path (call from a background
    thread at startup). Takes the same lock as knowledge_search, so a
    concurrent first query can't double-build — it just waits.
    """
    with _lock:
        try:
            indexer.ensure_index(api_key)
        except Exception as e:
            print(f"[RAG] Warm build failed (first search will retry): {e}")


def knowledge_search(query: str, k: int = DEFAULT_K, api_key: str | None = None) -> str:
    """Retrieve the most relevant knowledge chunks for ``query``.

    Returns a labeled, spoken-friendly text block, or a clear no-results note so
    the model can say it doesn't have that information rather than guessing.
    """
    query = (query or "").strip()
    if not query:
        return "No search query was provided."

    with _lock:
        try:
            indexer.ensure_index(api_key)
        except Exception as e:
            return f"The knowledge base is unavailable right now ({e})."
        cache = _load_cache()

    if not cache or cache["vectors"].shape[0] == 0:
        return "The knowledge base is empty. No stored information to search."

    try:
        # Collapse whitespace: cache key and embedded text in one. (Not
        # lowercased — keep the embedded text byte-identical to what the
        # caller asked, casing carries little but nonzero signal.)
        q_vec = _embed_query(" ".join(query.split()), api_key)
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
