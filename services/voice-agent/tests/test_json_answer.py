"""nlu/json_answer.py: reading a streamed {"found", "answer"} as it arrives."""

import json
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.json_answer import ANSWER_SCHEMA, AnswerStream  # noqa: E402


def run(raw: str, size: int):
    p = AnswerStream()
    out = ""
    seen_found_at = None
    for i in range(0, len(raw), size):
        out += p.feed(raw[i:i + size])
        if p.found is not None and seen_found_at is None:
            seen_found_at = i
    return p, out, seen_found_at


class AnswerStreamTests(unittest.TestCase):
    def test_found_is_first_in_the_schema(self):
        self.assertEqual(list(ANSWER_SCHEMA["properties"]), ["found", "answer"])

    def test_found_is_known_as_soon_as_its_value_arrives_and_false_releases_nothing(self):
        p, out, at = run('{"found": false, "answer": ""}', 3)
        self.assertEqual((p.found, out), (False, ""))
        self.assertLess(at, 20)

    def test_every_chunk_size_gives_the_same_decoded_answer(self):
        answer = 'He said "hello" \\ and left.\nNew line, tab\t, caf\u00e9, \U0001F600, slash/ok.'
        raw = json.dumps({"found": True, "answer": answer})
        for size in (1, 2, 3, 5, 7, 11, 1000):
            with self.subTest(size=size):
                p, out, _ = run(raw, size)
                self.assertEqual((p.found, out, p.complete), (True, answer, True))

    def test_ascii_escaped_unicode_and_surrogate_pairs(self):
        raw = json.dumps({"found": True, "answer": "caf\u00e9 \U0001F600 \u4e2d"}, ensure_ascii=True)
        self.assertIn("\\ud83d", raw)
        for size in (1, 4, 9):
            with self.subTest(size=size):
                self.assertEqual(run(raw, size)[1], "caf\u00e9 \U0001F600 \u4e2d")

    def test_text_comes_out_before_the_closing_quote(self):
        p = AnswerStream()
        self.assertEqual(p.feed('{"found": true, "ans'), "")
        self.assertEqual(p.feed('wer": "First sentence. Second'), "First sentence. Second")
        self.assertFalse(p.complete)
        self.assertEqual(p.feed(' one."}'), " one.")
        self.assertTrue(p.complete)

    def test_an_answer_written_before_found_is_held_back(self):
        p = AnswerStream()
        self.assertEqual(p.feed('{"answer": "Held text. ", '), "")
        self.assertEqual(p.feed('"found": true}'), "Held text. ")

    def test_an_escape_split_across_chunks_waits(self):
        p = AnswerStream()
        self.assertEqual(p.feed('{"found": true, "answer": "a'), "a")
        self.assertEqual(p.feed("\\"), "")  # a lone backslash: the escape is not complete yet
        self.assertEqual(p.feed("n"), "\n")
        self.assertEqual(p.feed("b\\u00"), "b")
        self.assertEqual(p.feed("e9"), "\u00e9")

    def test_no_found_at_all_stays_none(self):
        p, out, _ = run('{"answer": "text"}', 4)
        self.assertEqual((p.found, out), (None, ""))


if __name__ == "__main__":
    unittest.main()
