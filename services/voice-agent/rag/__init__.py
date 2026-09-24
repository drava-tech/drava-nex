"""TRAVIS knowledge retrieval (RAG) package.

Builds a local vector index over the experience-center docs, cube/LEGO know-how,
and visitor memory, and exposes ``knowledge_search`` for the brain to call as a
tool.
"""

from rag.indexer import build_index, ensure_index
from rag.retriever import knowledge_search

__all__ = ["knowledge_search", "build_index", "ensure_index"]
