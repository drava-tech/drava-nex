"""Builds and persists the TRAVIS knowledge vector index.

Documents from :mod:`rag.sources` are split into ~2000-char chunks, embedded
locally with Ollama (``nomic-embed-text``) and stored as a float32 matrix
(``index.npz``) plus chunk metadata (``index_meta.json``). A ``corpus_hash`` of
the source files (and the ``embed_model``) lets :func:`ensure_index` rebuild only
when the corpus or the embedding model changes.
"""

import hashlib
import json
import re

import httpx
import numpy as np

from rag.sources import (
    BASE_DIR,
    Document,
    load_all_documents,
    source_paths,
)

EMBED_MODEL = "nomic-embed-text"  # Ollama model: `ollama pull nomic-embed-text`
EMBED_DIM = 768
CHUNK_CHARS = 2000
CHUNK_OVERLAP = 150
EMBED_BATCH = 16
EMBED_TIMEOUT_S = 120.0  # the first call also loads the model into Ollama
# nomic-embed-text is trained with task prefixes; without them retrieval quality drops.
_TASK_PREFIX = {"RETRIEVAL_DOCUMENT": "search_document: ", "RETRIEVAL_QUERY": "search_query: "}

INDEX_DIR = BASE_DIR / "rag"
VECTORS_PATH = INDEX_DIR / "index.npz"
META_PATH = INDEX_DIR / "index_meta.json"
API_CONFIG_PATH = BASE_DIR / "config" / "api_keys.json"


def _ollama_url() -> str:
    """Ollama address: `ollama_url` from the config, like the language model uses."""
    try:
        with open(API_CONFIG_PATH, "r", encoding="utf-8") as f:
            url = str(json.load(f).get("ollama_url") or "")
    except (OSError, ValueError):
        url = ""
    return (url or "http://127.0.0.1:11434").rstrip("/")


def chunk_text(text: str) -> list[str]:
    """Split on paragraph boundaries into <=CHUNK_CHARS windows with overlap."""
    text = (text or "").strip()
    if len(text) <= CHUNK_CHARS:
        return [text] if text else []

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        if len(para) > CHUNK_CHARS:
            # Hard-split an oversized paragraph.
            if current:
                chunks.append(current)
                current = ""
            for i in range(0, len(para), CHUNK_CHARS - CHUNK_OVERLAP):
                chunks.append(para[i : i + CHUNK_CHARS])
            continue
        if current and len(current) + len(para) + 2 > CHUNK_CHARS:
            chunks.append(current)
            tail = current[-CHUNK_OVERLAP:] if CHUNK_OVERLAP else ""
            current = (tail + "\n\n" + para).strip()
        else:
            current = (current + "\n\n" + para).strip() if current else para
    if current:
        chunks.append(current)
    return chunks


CHUNKING = "sections-v1"  # bumped when chunks change shape, so an index built the old way is rebuilt
_SAY = re.compile(r"^\s*<!--\s*say:\s*(.+?)\s*-->\s*$", re.I | re.M)


def split_sections(text: str) -> list[tuple[str, str, str]]:
    """[(heading, spoken topic, body)] for a markdown document: the text before the first `## ` (if any) is the "overview",
    then one entry per `## ` section. A `<!-- say: our clients -->` line inside a section is how Travis names it when it
    offers it ("I can tell you about our clients"); without one the heading, lower-cased, is used. Text with no `##`
    headings is one section."""
    parts = re.split(r"\n(?=## )", text.strip())
    out: list[tuple[str, str, str]] = []
    for n, part in enumerate(parts):
        if part.startswith("## "):
            heading, _, body = part.partition("\n")
            heading = heading[3:].strip()
        else:
            heading, body = "overview", re.sub(r"^# .*\n?", "", part, count=1)  # the "# Title" line is the document's name
        say = _SAY.search(body)
        topic = say.group(1).strip() if say else heading.lower()
        body = _SAY.sub("", body).strip()
        if body:
            out.append((heading, topic, body))
    return out or [("overview", "overview", text.strip())] if text.strip() else []


def _build_chunks(documents: list[Document]) -> list[dict]:
    chunks: list[dict] = []
    for doc in documents:
        for s, (heading, topic, body) in enumerate(split_sections(doc.text)):
            for i, piece in enumerate(chunk_text(body)):
                chunks.append(
                    {
                        "doc_id": doc.doc_id,
                        "chunk_id": f"{doc.doc_id}#{s}.{i}",
                        "title": doc.title,
                        "section": heading,
                        "topic": topic,
                        "group": doc.group,
                        "source_label": doc.source_label,
                        "text": piece,
                    }
                )
    return chunks


def embed_text(chunk: dict) -> str:
    """What is embedded for a chunk: its document and section name too, so a search for "clients" finds the Clients section."""
    return f"{chunk['title']}: {chunk['section']}. {chunk['text']}"


def corpus_hash() -> str:
    """Stable hash of all source file contents; changes when the corpus does."""
    h = hashlib.sha256()
    for path in source_paths():
        try:
            h.update(path.as_posix().encode("utf-8"))
            h.update(path.read_bytes())
        except Exception:
            continue
    return h.hexdigest()


def embed_texts(texts: list[str], task_type: str) -> np.ndarray:
    """Embed texts with the local Ollama model. Returns an (N, EMBED_DIM) float32 matrix.

    Isolated here so tests can monkeypatch it with a deterministic fake.
    """
    prefix = _TASK_PREFIX.get(task_type, "")
    url = f"{_ollama_url()}/api/embed"
    out: list[list[float]] = []
    with httpx.Client(timeout=EMBED_TIMEOUT_S) as client:
        for start in range(0, len(texts), EMBED_BATCH):
            batch = [prefix + t for t in texts[start : start + EMBED_BATCH]]
            resp = client.post(url, json={"model": EMBED_MODEL, "input": batch, "keep_alive": "30m"})
            if resp.status_code == 404:
                raise RuntimeError(f"embedding model '{EMBED_MODEL}' is not installed (run: ollama pull {EMBED_MODEL})")
            resp.raise_for_status()
            out.extend(resp.json()["embeddings"])
    return _normalize(np.asarray(out, dtype=np.float32))


def _normalize(mat: np.ndarray) -> np.ndarray:
    if mat.size == 0:
        return mat.reshape(0, EMBED_DIM)
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return mat / norms


def build_index() -> int:
    """(Re)build the full index from all sources. Returns the chunk count."""
    documents = load_all_documents()
    chunks = _build_chunks(documents)
    INDEX_DIR.mkdir(parents=True, exist_ok=True)

    if not chunks:
        # Persist an empty index so ensure_index doesn't loop rebuilding.
        np.savez(VECTORS_PATH, vectors=np.zeros((0, EMBED_DIM), dtype=np.float32))
        META_PATH.write_text(
            json.dumps(
                {"corpus_hash": corpus_hash(), "embed_model": EMBED_MODEL, "chunking": CHUNKING, "chunks": []},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print("[RAG] Index built: 0 chunks (empty corpus).")
        return 0

    vectors = embed_texts([embed_text(c) for c in chunks], "RETRIEVAL_DOCUMENT")
    np.savez(VECTORS_PATH, vectors=vectors)
    META_PATH.write_text(
        json.dumps(
            {"corpus_hash": corpus_hash(), "embed_model": EMBED_MODEL, "chunking": CHUNKING, "chunks": chunks},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    by_source: dict[str, int] = {}
    for c in chunks:
        by_source[c["source_label"]] = by_source.get(c["source_label"], 0) + 1
    print(
        f"[RAG] Index built: {len(chunks)} chunks "
        f"({', '.join(f'{k}={v}' for k, v in by_source.items())})."
    )
    return len(chunks)


def index_is_current() -> bool:
    if not VECTORS_PATH.exists() or not META_PATH.exists():
        return False
    try:
        meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    except Exception:
        return False
    # An index built with another embedding model (e.g. the old cloud one) has incompatible vectors.
    return meta.get("corpus_hash") == corpus_hash() and meta.get("embed_model") == EMBED_MODEL and meta.get("chunking") == CHUNKING


def ensure_index() -> bool:
    """Build the index if missing or stale. Returns True if a build ran."""
    if index_is_current():
        return False
    build_index()
    return True


if __name__ == "__main__":
    build_index()
