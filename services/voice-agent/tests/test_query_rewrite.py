"""nlu/query_rewrite.py: a question restated on its own, with its flags (scripted model)."""

import asyncio
import json
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.query_rewrite import SCHEMA, rewrite_question  # noqa: E402

SAID = [{"role": "user", "content": "Tell me about white tusker"}, {"role": "assistant", "content": "White Tusker is a brand experience design studio."}]


class _LLM:
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    async def complete_json(self, messages, schema, max_tokens=400):
        self.calls.append((messages, schema))
        return self.answer if isinstance(self.answer, str) else json.dumps(self.answer)


def run(llm, message, history, topic="company"):
    return asyncio.run(rewrite_question(llm, message, history, topic))


class RewriteTests(unittest.TestCase):
    def test_a_follow_up_comes_back_standalone_with_its_flags(self):
        llm = _LLM({"query": "more about White Tusker", "topic": "company", "wants_more": True})
        rw = run(llm, "tell me more about it", SAID)
        self.assertEqual((rw.query, rw.topic, rw.wants_more), ("more about White Tusker", "company", True))

    def test_the_conversation_so_far_is_what_the_model_reads(self):
        llm = _LLM({"query": "q", "topic": "company", "wants_more": False})
        run(llm, "who founded it", SAID)
        user = llm.calls[0][0][-1]["content"]
        self.assertIn("Visitor: Tell me about white tusker", user)
        self.assertIn("Travis: White Tusker is a brand experience design studio.", user)
        self.assertIn("Latest: who founded it", user)
        self.assertIs(llm.calls[0][1], SCHEMA)

    def test_nothing_to_ask_more_of_before_anything_was_said(self):
        llm = _LLM({"query": "more about White Tusker", "topic": "company", "wants_more": True})
        self.assertFalse(run(llm, "tell me more", []).wants_more)

    def test_an_unusable_answer_falls_back_to_the_message_and_the_planners_topic(self):
        for bad in ("sure! here you go", "{}", '{"query": 5}', json.dumps({"topic": "company"})):
            with self.subTest(bad=bad):
                rw = run(_LLM(bad), "what is this cms", [], "cms")
                self.assertEqual((rw.query, rw.topic, rw.wants_more), ("what is this cms", "cms", False))

    def test_the_planners_experience_center_topic_means_place_here(self):
        self.assertEqual(run(_LLM("nope"), "what is this place", [], "experience_center").topic, "place")

    def test_an_unknown_topic_from_the_model_keeps_the_planners(self):
        rw = run(_LLM({"query": "x", "topic": "weather", "wants_more": False}), "x", [], "travis")
        self.assertEqual(rw.topic, "travis")

    def test_an_empty_query_falls_back_to_the_message(self):
        rw = run(_LLM({"query": "  ", "topic": "company", "wants_more": False}), "where are you", [])
        self.assertEqual(rw.query, "where are you")


if __name__ == "__main__":
    unittest.main()
