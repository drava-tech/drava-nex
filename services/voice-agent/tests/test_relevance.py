"""The relevance gate: keyword pass, review parsing, and how it handles the
model's answer. (The model's actual judgement is checked by hand against the
real Qwen — these pin the code around it.)"""

import asyncio
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.relevance import RelevanceGate, Review, gate_messages, mentions_domain, parse_review  # noqa: E402


class _FakeChat:
    def __init__(self, answer: str):
        self.answer = answer
        self.calls: list[list[dict]] = []

    async def complete(self, messages, max_tokens=4):
        self.calls.append(messages)
        return self.answer


def _review(gate: RelevanceGate, command: str, history=None) -> Review:
    return asyncio.run(gate.review(command, history))


class DomainKeywordTests(unittest.TestCase):
    def test_room_words_are_in_domain(self):
        for text in ("make the lights blue", "show it on the big screen", "is the door locked", "tusker 27"):
            with self.subTest(text=text):
                self.assertTrue(mentions_domain(text))

    def test_general_questions_are_not(self):
        for text in ("what's the capital of France", "tell me a joke", "who won the match"):
            with self.subTest(text=text):
                self.assertFalse(mentions_domain(text))


class ParseReviewTests(unittest.TestCase):
    def test_ok_keeps_the_command(self):
        self.assertEqual(parse_review("OK", "lights on"), Review(True, "lights on"))

    def test_none_declines(self):
        self.assertEqual(parse_review("NONE", "tell me a joke"), Review(False, "", True))

    def test_keep_runs_only_the_in_scope_part(self):
        r = parse_review("KEEP: unlock the door", "unlock the door and tell me a joke")
        self.assertEqual(r, Review(True, "unlock the door", True))

    def test_keep_without_text_declines(self):
        self.assertFalse(parse_review("KEEP:", "x and y").allowed)

    def test_an_invented_rewrite_runs_the_original(self):
        # "and the other one" must not become a command the user never said.
        r = parse_review("KEEP: turn on the other edge light", "and the other one")
        self.assertEqual(r, Review(True, "and the other one"))

    def test_quotes_and_case_are_tolerated(self):
        r = parse_review('keep: "Set the AC to 22"', "set the ac to 22 and sing me a song")
        self.assertEqual(r, Review(True, "Set the AC to 22", True))

    def test_unreadable_answers_fail_open(self):
        for answer in ("", "maybe?", "I think so"):
            with self.subTest(answer=answer):
                self.assertEqual(parse_review(answer, "hello there"), Review(True, "hello there"))

    def test_only_the_first_line_counts(self):
        self.assertFalse(parse_review("NONE\nbecause it is a joke", "joke").allowed)


class GateTests(unittest.TestCase):
    def test_a_plain_room_command_never_calls_the_model(self):
        chat = _FakeChat("NONE")
        self.assertEqual(_review(RelevanceGate(chat), "make the lights blue"), Review(True, "make the lights blue"))
        self.assertEqual(chat.calls, [])

    def test_several_asks_are_reviewed_even_with_a_room_word(self):
        chat = _FakeChat("KEEP: unlock the door")
        r = _review(RelevanceGate(chat), "unlock the door and tell me a joke")
        self.assertEqual(r, Review(True, "unlock the door", True))
        self.assertEqual(len(chat.calls), 1)

    def test_unknown_topics_are_reviewed(self):
        chat = _FakeChat("NONE")
        self.assertFalse(_review(RelevanceGate(chat), "what's the capital of France").allowed)

    def test_disabled_gate_lets_everything_through(self):
        chat = _FakeChat("NONE")
        r = _review(RelevanceGate(chat, enabled=False), "tell me a joke")
        self.assertEqual(r, Review(True, "tell me a joke"))
        self.assertEqual(chat.calls, [])

    def test_the_last_exchange_is_sent_as_context(self):
        history = [
            {"role": "user", "content": "turn on the edge light"},
            {"role": "assistant", "content": "tusker edge is on."},
        ]
        _, user = gate_messages("and the other one", history)[0], gate_messages("and the other one", history)[1]
        self.assertIn("tusker edge is on.", user["content"])
        self.assertIn("Latest message: and the other one", user["content"])


if __name__ == "__main__":
    unittest.main()
