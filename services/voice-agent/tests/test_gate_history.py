"""History is in scope only as the history of White Tusker, the company, Travis or the CMS (nlu/relevance.py)."""

import asyncio
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.relevance import RelevanceGate, history_out_of_scope  # noqa: E402


class _Chat:
    """A model that would allow anything: only the code rule can decline here."""

    def __init__(self):
        self.asked = 0

    async def complete(self, messages, max_tokens=4):
        self.asked += 1
        return "OK"


class RuleTests(unittest.TestCase):
    def test_a_history_that_is_not_ours_is_out_of_scope(self):
        for t in ("Tell me about the history of lighting design.", "history of lighting", "what is the history of india", "tell me the history of art"):
            with self.subTest(t=t):
                self.assertTrue(history_out_of_scope(t))

    def test_the_company_cms_or_travis_history_is_in_scope(self):
        for t in ("history of White Tusker", "how did your company start", "what is the history of the CMS", "tell me about the history of the platform",
                  "what is your history", "history of Travis", "tell me the company history", "history of the white tusker studio"):
            with self.subTest(t=t):
                self.assertFalse(history_out_of_scope(t))

    def test_no_history_word_is_never_caught(self):
        for t in ("turn on the lights", "who founded white tusker", "tell me about lighting design"):
            self.assertFalse(history_out_of_scope(t))

    def test_its_history_follows_what_was_just_said(self):
        about_us = [{"role": "user", "content": "tell me about white tusker"}, {"role": "assistant", "content": "White Tusker is a studio."}]
        about_art = [{"role": "user", "content": "tell me about lighting"}, {"role": "assistant", "content": "Lighting is the room's mood."}]
        self.assertFalse(history_out_of_scope("what about its history", about_us))
        self.assertTrue(history_out_of_scope("what about its history", about_art))
        self.assertTrue(history_out_of_scope("what about its history", []))


class GateTests(unittest.TestCase):
    def review(self, text, history=None):
        chat = _Chat()
        return asyncio.run(RelevanceGate(chat).review(text, history)), chat

    def test_declined_even_though_it_holds_a_room_word_and_without_asking_the_model(self):
        r, chat = self.review("Tell me about the history of lighting design.")
        self.assertFalse(r.allowed)
        self.assertEqual(chat.asked, 0)

    def test_ours_goes_on_to_the_model_as_before(self):
        for t in ("history of White Tusker", "how did your company start"):
            r, chat = self.review(t)
            self.assertTrue(r.allowed, t)

    def test_the_rule_is_off_with_the_gate(self):
        r = asyncio.run(RelevanceGate(_Chat(), enabled=False).review("history of lighting design"))
        self.assertTrue(r.allowed)


if __name__ == "__main__":
    unittest.main()
