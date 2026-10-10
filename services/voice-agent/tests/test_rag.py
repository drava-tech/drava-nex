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


def _fake_embed(texts, task_type):
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
            return indexer.build_index()

    def test_build_writes_index(self):
        n = self._build()
        self.assertEqual(n, 3)
        self.assertTrue(indexer.VECTORS_PATH.exists())
        self.assertTrue(indexer.META_PATH.exists())

    def test_ensure_index_rebuilds_only_when_hash_changes(self):
        with mock.patch.object(indexer, "load_all_documents", return_value=self._docs):
            with mock.patch.object(indexer, "corpus_hash", return_value="h1"):
                self.assertTrue(indexer.ensure_index())  # first build
                self.assertFalse(indexer.ensure_index())  # unchanged → no rebuild
            with mock.patch.object(indexer, "corpus_hash", return_value="h2"):
                self.assertTrue(indexer.ensure_index())  # changed → rebuild

    def test_search_returns_relevant_chunk(self):
        self._build()
        with mock.patch.object(indexer, "corpus_hash", return_value="h1"):
            out = retriever.knowledge_search(
                "Pizza: overview. The visitor's favorite food is pizza.", k=1  # = what is embedded for that chunk (title, section, text)
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
                "something totally unrelated", k=2
            )
        self.assertIn("No relevant information", out)

    def test_empty_index_is_handled(self):
        with (
            mock.patch.object(indexer, "load_all_documents", return_value=[]),
            mock.patch.object(indexer, "corpus_hash", return_value="h0"),
        ):
            indexer.build_index()
            out = retriever.knowledge_search("anything")
        self.assertIn("empty", out.lower())


class OllamaEmbedderTests(unittest.TestCase):
    def _client(self, handler):
        import httpx

        real = httpx.Client
        return mock.patch.object(indexer.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))

    def test_embed_texts_sends_task_prefix_and_returns_unit_vectors(self):
        import json as _json
        import httpx

        seen = []

        def handler(request):
            body = _json.loads(request.content)
            seen.append(body)
            return httpx.Response(200, json={"embeddings": [[3.0] + [0.0] * (EMBED_DIM - 1) for _ in body["input"]]})

        with self._client(handler):
            out = indexer.embed_texts(["hello", "world"], "RETRIEVAL_QUERY")
        self.assertEqual(seen[0]["model"], indexer.EMBED_MODEL)
        self.assertEqual(seen[0]["input"], ["search_query: hello", "search_query: world"])
        self.assertEqual(out.shape, (2, EMBED_DIM))
        self.assertAlmostEqual(float(np.linalg.norm(out[0])), 1.0, places=5)

    def test_missing_model_says_how_to_install_it(self):
        import httpx

        with self._client(lambda request: httpx.Response(404, json={"error": "model not found"})):
            with self.assertRaises(RuntimeError) as ctx:
                indexer.embed_texts(["x"], "RETRIEVAL_DOCUMENT")
        self.assertIn("ollama pull", str(ctx.exception))

    def test_index_built_with_another_model_is_stale(self):
        import json as _json
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            (tmp / "index.npz").write_bytes(b"x")
            meta = tmp / "index_meta.json"
            with mock.patch.object(indexer, "VECTORS_PATH", tmp / "index.npz"),                     mock.patch.object(indexer, "META_PATH", meta),                     mock.patch.object(indexer, "corpus_hash", return_value="h1"):
                meta.write_text(_json.dumps({"corpus_hash": "h1", "chunks": []}), encoding="utf-8")
                self.assertFalse(indexer.index_is_current())  # no embed_model recorded (old cloud index)
                meta.write_text(_json.dumps({"corpus_hash": "h1", "embed_model": indexer.EMBED_MODEL, "chunking": indexer.CHUNKING, "chunks": []}), encoding="utf-8")
                self.assertTrue(indexer.index_is_current())


if __name__ == "__main__":
    unittest.main()


class SectionChunkTests(unittest.TestCase):
    """The knowledge files are chunked by `## ` section, each with its group and the name Travis uses when it offers it."""

    TEXT = ("# White Tusker\n\nIntro line.\n\n## Who we are\n<!-- say: who we are -->\n\nA studio.\n\n"
            "## Clients\n<!-- say: our clients -->\n\nBoeing and Bosch.\n\n## Where and how to reach us\n\nIndiranagar.")

    def test_sections_keep_their_heading_and_spoken_name(self):
        secs = indexer.split_sections(self.TEXT)
        self.assertEqual([(h, t) for h, t, _ in secs],
                         [("overview", "overview"), ("Who we are", "who we are"), ("Clients", "our clients"), ("Where and how to reach us", "where and how to reach us")])
        self.assertEqual(secs[2][2], "Boeing and Bosch.")  # the say-comment is not part of the text
        self.assertNotIn("# White Tusker", secs[0][2])  # the document's title line is its name, not content

    def test_text_without_headings_is_one_section(self):
        self.assertEqual(indexer.split_sections("Just a paragraph."), [("overview", "overview", "Just a paragraph.")])
        self.assertEqual(indexer.split_sections("   "), [])

    def test_group_comes_from_the_first_line_or_the_file_name(self):
        self.assertEqual(sources.split_group("<!-- group: Travis -->\n# Travis\ntext", "x"), ("travis", "# Travis\ntext"))
        self.assertEqual(sources.split_group("# CMS\ntext", "cms_platform")[0], "cms")
        self.assertEqual(sources.split_group("# Anything\ntext", "the_white_tusker")[0], "company")

    def test_chunks_carry_group_section_and_topic(self):
        doc = Document("doc:a.md", "A", self.TEXT, "Experience Center", group="company")
        chunks = indexer._build_chunks([doc])
        self.assertEqual({c["group"] for c in chunks}, {"company"})
        self.assertEqual([c["topic"] for c in chunks], ["overview", "who we are", "our clients", "where and how to reach us"])
        self.assertEqual(len({c["chunk_id"] for c in chunks}), len(chunks))
        self.assertIn("Clients", indexer.embed_text(chunks[2]))  # the section name is embedded too

    def test_a_long_section_is_still_split(self):
        doc = Document("d", "A", "## Big\n\n" + "\n\n".join(f"Paragraph {i}. " + "x" * 900 for i in range(6)), "Experience Center")
        self.assertGreater(len([c for c in indexer._build_chunks([doc]) if c["section"] == "Big"]), 1)


class HeadingMatchTests(unittest.TestCase):
    PROJECTS = {"section": "Projects", "topic": "our projects"}
    FOUNDERS = {"section": "Founders and leadership", "topic": "our founders"}
    WHERE = {"section": "Where and how to reach us", "topic": "where we are"}

    def test_a_query_word_that_is_a_heading_word_matches(self):
        self.assertTrue(retriever.heading_match("white tusker projects", self.PROJECTS))
        self.assertTrue(retriever.heading_match("what project did they do", self.PROJECTS))  # project / projects
        self.assertTrue(retriever.heading_match("who founded it", self.FOUNDERS))  # founded / founders
        self.assertTrue(retriever.heading_match("where are they based", self.WHERE))

    def test_question_filler_alone_never_matches(self):
        for q in ("who is it", "tell me more about them", "what do you do", "how are they"):
            for sec in (self.PROJECTS, self.FOUNDERS, self.WHERE):
                self.assertFalse(retriever.heading_match(q, sec), (q, sec["section"]))

    def test_unrelated_words_do_not_match(self):
        self.assertFalse(retriever.heading_match("what awards have they won", self.PROJECTS))


class SectionSearchTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        from pathlib import Path

        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self._patches = [
            mock.patch.object(indexer, "VECTORS_PATH", tmp / "index.npz"), mock.patch.object(indexer, "META_PATH", tmp / "index_meta.json"),
            mock.patch.object(indexer, "INDEX_DIR", tmp), mock.patch.object(retriever, "VECTORS_PATH", tmp / "index.npz"),
            mock.patch.object(retriever, "META_PATH", tmp / "index_meta.json"), mock.patch.object(indexer, "embed_texts", _fake_embed),
        ]
        for p in self._patches:
            p.start()
        retriever._cache = None
        retriever._embed_query.cache_clear()
        docs = [Document("doc:wt", "White Tusker", "## Clients\nBoeing and Bosch.\n\n## Location\nIndiranagar.", "Experience Center", group="company"),
                Document("doc:tr", "Travis", "## About\nThe voice assistant.", "Experience Center", group="travis")]
        self._hash = mock.patch.object(indexer, "corpus_hash", return_value="h")
        self._docs_patch = mock.patch.object(indexer, "load_all_documents", return_value=docs)
        self._hash.start()
        self._docs_patch.start()
        indexer.build_index()
        self.chunks = indexer._build_chunks(docs)
        self.q = {c["section"]: indexer.embed_text(c) for c in self.chunks}  # a query identical to a chunk's embedded text scores 1.0

    def tearDown(self):
        self._hash.stop()
        self._docs_patch.stop()
        for p in self._patches:
            p.stop()
        self._tmp.cleanup()
        retriever._cache = None
        retriever._embed_query.cache_clear()

    def test_search_returns_the_best_section_first_with_its_metadata(self):
        hits = retriever.search(self.q["Clients"], k=3, min_score=0.9)
        self.assertEqual([h.label for h in hits], ["White Tusker: Clients"])
        self.assertEqual((hits[0].group, hits[0].topic), ("company", "clients"))

    def test_groups_limit_what_can_be_found(self):
        self.assertEqual(retriever.search(self.q["Clients"], groups={"travis"}, min_score=0.9), [])
        self.assertEqual(len(retriever.search(self.q["About"], groups={"travis"}, min_score=0.9)), 1)

    def test_used_sections_can_be_excluded(self):
        first = retriever.search(self.q["Clients"], min_score=0.9)[0]
        self.assertEqual(retriever.search(self.q["Clients"], exclude={first.chunk_id}, min_score=0.9), [])

    def test_k_and_the_score_floor_are_respected(self):
        self.assertEqual(len(retriever.search(self.q["Clients"], k=2, min_score=0.0)), 2)
        self.assertEqual(retriever.search("", min_score=0.0), [])

    def test_sections_lists_what_exists_by_group(self):
        self.assertEqual(sorted(s["topic"] for s in retriever.sections({"company"})), ["clients", "location"])
        self.assertEqual(len(retriever.sections()), 3)

    def test_an_index_built_with_the_old_chunking_is_rebuilt(self):
        import json

        meta = json.loads(indexer.META_PATH.read_text(encoding="utf-8"))
        self.assertTrue(indexer.index_is_current())
        meta.pop("chunking")
        indexer.META_PATH.write_text(json.dumps(meta), encoding="utf-8")
        self.assertFalse(indexer.index_is_current())
