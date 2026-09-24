"""Builds and persists the TRAVIS knowledge vector index.

Documents from :mod:`rag.sources` are split into ~2000-char chunks, embedded
with Gemini ``gemini-embedding-001`` and stored as a float32 matrix
(``index.npz``) plus chunk metadata (``index_meta.json``). A ``corpus_hash`` of
the source files lets :func:`ensure_index` rebuild only when the corpus changes.
"""

import hashlib
import json

import numpy as np

from rag.sources import (
    BASE_DIR,
    Document,
    load_all_documents,
    source_paths,
)

EMBED_MODEL = "gemini-embedding-001"
EMBED_DIM = 768
CHUNK_CHARS = 2000
CHUNK_OVERLAP = 150
EMBED_BATCH = 64

INDEX_DIR = BASE_DIR / "rag"
VECTORS_PATH = INDEX_DIR / "index.npz"
META_PATH = INDEX_DIR / "index_meta.json"
API_CONFIG_PATH = BASE_DIR / "config" / "api_keys.json"


def _get_api_key() -> str:
    with open(API_CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)["gemini_api_key"]


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


def _build_chunks(documents: list[Document]) -> list[dict]:
    chunks: list[dict] = []
    for doc in documents:
        for i, piece in enumerate(chunk_text(doc.text)):
            chunks.append(
                {
                    "doc_id": doc.doc_id,
                    "chunk_id": f"{doc.doc_id}#{i}",
                    "title": doc.title,
                    "source_label": doc.source_label,
                    "text": piece,
                }
            )
    return chunks


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


def embed_texts(
    texts: list[str], task_type: str, api_key: str | None = None
) -> np.ndarray:
    """Embed texts with Gemini. Returns an (N, EMBED_DIM) float32 matrix.

    Isolated here so tests can monkeypatch it with a deterministic fake.
    """
    from google import genai

    # pyrefly: ignore [missing-import]
    from google.genai import types

    client = genai.Client(api_key=api_key or _get_api_key())
    out: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH):
        batch = texts[start : start + EMBED_BATCH]
        resp = client.models.embed_content(
            model=EMBED_MODEL,
            contents=batch,
            config=types.EmbedContentConfig(
                task_type=task_type,
                output_dimensionality=EMBED_DIM,
            ),
        )
        out.extend(e.values for e in resp.embeddings)
    return _normalize(np.asarray(out, dtype=np.float32))


def _normalize(mat: np.ndarray) -> np.ndarray:
    if mat.size == 0:
        return mat.reshape(0, EMBED_DIM)
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return mat / norms


def build_index(api_key: str | None = None) -> int:
    """(Re)build the full index from all sources. Returns the chunk count."""
    documents = load_all_documents()
    chunks = _build_chunks(documents)
    INDEX_DIR.mkdir(parents=True, exist_ok=True)

    if not chunks:
        # Persist an empty index so ensure_index doesn't loop rebuilding.
        np.savez(VECTORS_PATH, vectors=np.zeros((0, EMBED_DIM), dtype=np.float32))
        META_PATH.write_text(
            json.dumps(
                {"corpus_hash": corpus_hash(), "chunks": []},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print("[RAG] Index built: 0 chunks (empty corpus).")
        return 0

    vectors = embed_texts([c["text"] for c in chunks], "RETRIEVAL_DOCUMENT", api_key)
    np.savez(VECTORS_PATH, vectors=vectors)
    META_PATH.write_text(
        json.dumps(
            {"corpus_hash": corpus_hash(), "chunks": chunks},
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
    return meta.get("corpus_hash") == corpus_hash()


def ensure_index(api_key: str | None = None) -> bool:
    """Build the index if missing or stale. Returns True if a build ran."""
    if index_is_current():
        return False
    build_index(api_key)
    return True


if __name__ == "__main__":
    build_index()
