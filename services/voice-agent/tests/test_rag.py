import hashlib
import unittest
from unittest import mock

import numpy as np

from rag import indexer, retriever, sources
from rag.indexer import chunk_text, EMBED_DIM
from rag.sources import Document


def _fake_vector(text: str) -> list[float]:
    """Deterministic pseudo-embedding: seed an RNG from the text so identical
    text maps to identical vectors and similar queries land near their source."""
    seed = int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:8], 16)
    rng = np.random.default_rng(seed)
    return rng.standard_normal(EMBED_DIM).astype(np.float32).tolist()


def _fake_embed(texts, task_type, api_key=None):
    mat = np.asarray([_fake_vector(t) for t in texts], dtype=np.float32)
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return mat / norms


class ChunkTextTests(unittest.TestCase):
    def test_short_text_is_one_chunk(self):
        self.assertEqual(chunk_text("hello world"), ["hello world"])

    def test_empty_text_yields_no_chunks(self):
        self.assertEqual(chunk_text("   "), [])

    def test_long_text_splits_with_coverage(self):
        para = ("A" * 1500 + "\n\n") * 4
        chunks = chunk_text(para)
        self.assertGreater(len(chunks), 1)
        for c in chunks:
            self.assertLessEqual(len(c), indexer.CHUNK_CHARS)


class FrontmatterTests(unittest.TestCase):
    def test_parses_keys_quotes_and_lists(self):
        meta, body = sources._parse_frontmatter(
            "---\n"
            "name: cube-notation\n"
            'title: "Rubik\'s Cube notation"\n'
            "tags: [rubiks, basics]\n"
            "---\n"
            "U is the up face.\n"
        )
        self.assertEqual(meta["name"], "cube-notation")
        self.assertEqual(meta["title"], "Rubik's Cube notation")
        self.assertEqual(meta["tags"], "rubiks, basics")
        self.assertEqual(body, "U is the up face.")

    def test_no_frontmatter_returns_whole_body(self):
        meta, body = sources._parse_frontmatter("just text, no fence")
        self.assertEqual(meta, {})
        self.assertEqual(body, "just text, no fence")


class OkfLoaderTests(unittest.TestCase):
    def test_loads_concept_files_into_documents(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            bundle = Path(tmp)
            (bundle / "cube").mkdir()
            (bundle / "cube" / "cube-notation.md").write_text(
                "---\n"
                "name: cube-notation\n"
                'title: "Rubik\'s Cube notation"\n'
                'source_label: "Cube Coach"\n'
                "---\n"
                "U is the up face clockwise.\n",
                encoding="utf-8",
            )
            # A file with no body should be skipped.
            (bundle / "empty.md").write_text("---\nname: x\n---\n", encoding="utf-8")

            with mock.patch.object(sources, "OKF_DIR", bundle):
                docs = sources.load_okf_documents()

        self.assertEqual(len(docs), 1)
        doc = docs[0]
        self.assertEqual(doc.doc_id, "okf:cube/cube-notation.md")
        self.assertEqual(doc.title, "Rubik's Cube notation")
        self.assertEqual(doc.source_label, "Cube Coach")
        self.assertIn("up face", doc.text)


class IndexAndRetrieveTests(unittest.TestCase):
    def setUp(self):
        # Redirect index files into a temp dir for isolation.
        import tempfile
        from pathlib import Path

        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self._patches = [
            mock.patch.object(indexer, "VECTORS_PATH", tmp / "index.npz"),
            mock.patch.object(indexer, "META_PATH", tmp / "index_meta.json"),
            mock.patch.object(indexer, "INDEX_DIR", tmp),
            mock.patch.object(retriever, "VECTORS_PATH", tmp / "index.npz"),
            mock.patch.object(retriever, "META_PATH", tmp / "index_meta.json"),
            mock.patch.object(indexer, "embed_texts", _fake_embed),
        ]
        for p in self._patches:
            p.start()
        retriever._cache = None
        retriever._embed_query.cache_clear()  # don't leak fake embeddings across tests

        self._docs = [
            Document(
                "d1",
                "Hours",
                "The center opens at ten in the morning.",
                "Experience Center",
            ),
            Document(
                "d2",
                "Cube",
                "The middle layer edge trick uses U R U prime.",
                "Cube Coach",
            ),
            Document(
                "d3",
                "Pizza",
                "The visitor's favorite food is pizza.",
                "What I know about you",
            ),
        ]

    def tearDown(self):
        for p in self._patches:
            p.stop()
        self._tmp.cleanup()
        retriever._cache = None
        retriever._embed_query.cache_clear()

    def _build(self):
        with (
            mock.patch.object(indexer, "load_all_documents", return_value=self._docs),
            mock.patch.object(indexer, "corpus_hash", return_value="h1"),
        ):
            return indexer.build_index(api_key="x")

    def test_build_writes_index(self):
        n = self._build()
        self.assertEqual(n, 3)
        self.assertTrue(indexer.VECTORS_PATH.exists())
        self.assertTrue(indexer.META_PATH.exists())

    def test_ensure_index_rebuilds_only_when_hash_changes(self):
        with mock.patch.object(indexer, "load_all_documents", return_value=self._docs):
            with mock.patch.object(indexer, "corpus_hash", return_value="h1"):
                self.assertTrue(indexer.ensure_index("x"))  # first build
                self.assertFalse(indexer.ensure_index("x"))  # unchanged → no rebuild
            with mock.patch.object(indexer, "corpus_hash", return_value="h2"):
                self.assertTrue(indexer.ensure_index("x"))  # changed → rebuild

    def test_search_returns_relevant_chunk(self):
        self._build()
        with mock.patch.object(indexer, "corpus_hash", return_value="h1"):
            out = retriever.knowledge_search(
                "The visitor's favorite food is pizza.", k=1, api_key="x"
            )
        self.assertIn("pizza", out)
        self.assertIn("What I know about you", out)

    def test_irrelevant_query_reports_no_results(self):
        self._build()
        # A query identical to no doc and below the similarity floor.
        with (
            mock.patch.object(indexer, "corpus_hash", return_value="h1"),
            mock.patch.object(retriever, "MIN_SCORE", 0.99),
        ):
            out = retriever.knowledge_search(
                "something totally unrelated", k=2, api_key="x"
            )
        self.assertIn("No relevant information", out)

    def test_empty_index_is_handled(self):
        with (
            mock.patch.object(indexer, "load_all_documents", return_value=[]),
            mock.patch.object(indexer, "corpus_hash", return_value="h0"),
        ):
            indexer.build_index(api_key="x")
            out = retriever.knowledge_search("anything", api_key="x")
        self.assertIn("empty", out.lower())


if __name__ == "__main__":
    unittest.main()
