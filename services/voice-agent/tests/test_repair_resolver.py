"""nlu/repair_resolver.py in isolation: the cue prefilter, tag questions and corrections composed in code, and the two small model calls (a fake model)."""

import asyncio
import json
import sys
import time
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu import repair_resolver as rr  # noqa: E402


class FakeLLM:
    """complete_json(messages, schema, max_tokens): answers per schema (classify has "kind", rewrite has "resolved_request")."""

    def __init__(self, classify=None, rewrite=None, delay=0.0, boom=None):
        self.classify, self.rewrite, self.delay, self.boom = classify, rewrite, delay, boom
        self.calls = []

    async def complete_json(self, messages, schema, max_tokens=400):
        self.calls.append((messages, schema, max_tokens))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.boom:
            raise self.boom
        answer = self.classify if "kind" in schema["properties"] else self.rewrite
        return answer if isinstance(answer, str) else json.dumps(answer)


def run(coro):
    return asyncio.run(coro)


class CueTests(unittest.TestCase):
    def test_plain_requests_have_no_cue(self):
        for text in ("Tell me about yourself", "Show the whiteboard", "Stop", "Turn on tusker edge", "What is the CMS", "Make the room warmer", "Turn the AC right"):
            self.assertFalse(rr.needs_resolver(text), text)

    def test_repair_words_are_cues(self):
        for text in ("Tell me about yourself, no?", "Turn on the lights, actually the fan", "Tell me about yourself na", "forget it", "ok wait, the other screen",
                     "hold on, don't", "Open the film, right?", "leave it yaar", "There's no projector here, can you check"):
            self.assertTrue(rr.needs_resolver(text), text)

    def test_the_prefilter_costs_microseconds(self):
        started = time.perf_counter()
        for _ in range(20000):
            rr.needs_resolver("Tell me about yourself and show the whiteboard please")
        self.assertLess((time.perf_counter() - started) / 20000, 0.0001)  # well under 100 microseconds each


class TagTests(unittest.TestCase):
    def test_tag_questions_are_removed_in_code_and_mean_do_it(self):
        for text, want in (("Tell me about yourself, no?", "Tell me about yourself"), ("Tell me about yourself na", "Tell me about yourself"),
                           ("Show the film on the main screen, right?", "Show the film on the main screen"), ("Play the video na", "Play the video"),
                           ("I said turn on the cove light, isn't it", "I said turn on the cove light"), ("Turn on the lights, no?", "Turn on the lights")):
            tag = rr.tag_split(text)
            self.assertEqual((tag.request, tag.certain), (want, True), text)

    def test_a_bare_no_after_an_information_question_is_a_tag(self):
        tag = rr.tag_split("Tell me about yourself. No")
        self.assertEqual((tag.request, tag.certain), ("Tell me about yourself", True))

    def test_a_bare_no_after_a_device_action_needs_confirming(self):
        for text in ("Turn on the lights. No", "Lock the door, no", "Please switch off the AC. Nope"):
            self.assertFalse(rr.tag_split(text).certain, text)

    def test_not_tags(self):
        for text in ("There's no projector here, can you check", "Tell me about yourself. No, no, no", "No", "No projector is needed, just the screen", "forget it"):
            self.assertIsNone(rr.tag_split(text), text)


class CorrectionTests(unittest.TestCase):
    def test_composed_in_code_when_the_halves_allow_it(self):
        self.assertEqual(rr.compose_correction("Turn on the lights", "the fan"), "Turn on the fan")
        self.assertEqual(rr.compose_correction("Set tusker edge to 80", "60"), "Set tusker edge to 60")
        self.assertEqual(rr.compose_correction("Dim the cove light", "the sky light"), "Dim the sky light")

    def test_left_to_the_model_when_it_is_not_clear(self):
        self.assertIsNone(rr.compose_correction("Show the whiteboard on tusker 86", "the kiosk"))
        self.assertIsNone(rr.compose_correction("Book room 3 for Tuesday", "Wednesday"))
        self.assertIsNone(rr.compose_correction("Tell me about the studio", "60"))
        self.assertIsNone(rr.compose_correction("Set the AC to 24", "make it 22"))  # a whole new request keeps its context: the existing logic reads it
        self.assertIsNone(rr.compose_correction("Turn on the lights", "turn off the fan"))


class ClassifyTests(unittest.TestCase):
    def resolver(self, llm, **kw):
        return rr.RepairResolver(llm, **kw)

    def test_a_valid_answer(self):
        llm = FakeLLM(classify={"kind": "cancel", "confidence": 0.95})
        d = run(self.resolver(llm).classify("hold on, don't", "Show the whiteboard", "Showing it."))
        self.assertEqual((d.kind, d.source), ("cancel", "model"))
        self.assertIn("Show the whiteboard", llm.calls[0][0][1]["content"])  # the previous request is given as context
        self.assertIn("Showing it.", llm.calls[0][0][1]["content"])  # and Travis's previous reply

    def test_the_call_is_small(self):
        llm = FakeLLM(classify={"kind": "none", "confidence": 0.9})
        run(self.resolver(llm).classify("x, no"))
        self.assertLessEqual(llm.calls[0][2], 30)  # max tokens
        self.assertEqual(list(llm.calls[0][1]["properties"]), ["kind", "confidence"])

    def test_a_timeout_is_none_and_never_hangs(self):
        llm = FakeLLM(classify={"kind": "cancel", "confidence": 0.9}, delay=2.0)
        d = run(self.resolver(llm, timeout_ms=100).classify("hold on, don't"))
        self.assertEqual((d.kind, d.source), ("none", "timeout"))
        self.assertLess(d.ms, 600)

    def test_a_model_error_is_none(self):
        d = run(self.resolver(FakeLLM(boom=RuntimeError("ollama down"))).classify("hold on, don't"))
        self.assertEqual((d.kind, d.source), ("none", "error"))

    def test_unparseable_output_is_none(self):
        for bad in ("not json", {"kind": "banana", "confidence": 0.9}, {"confidence": 0.9}, {"kind": "cancel", "confidence": "high"}):
            d = run(self.resolver(FakeLLM(classify=bad)).classify("hold on, don't"))
            self.assertEqual((d.kind, d.source), ("none", "unparsed"), bad)

    def test_low_confidence_is_unclear(self):
        d = run(self.resolver(FakeLLM(classify={"kind": "cancel", "confidence": 0.4})).classify("hold on, don't"))
        self.assertEqual(d.kind, "unclear")

    def test_every_call_is_logged(self):
        r = self.resolver(FakeLLM(classify={"kind": "none", "confidence": 0.9}))
        run(r.classify("a, no"))
        self.assertEqual(len(r.stats), 1)
        self.assertTrue(set(r.stats[0]) >= {"kind", "confidence", "ms", "source"})


class RewriteTests(unittest.TestCase):
    def rewrite(self, answer, text="ok wait, the other screen", before="Show the whiteboard"):
        return run(rr.RepairResolver(FakeLLM(rewrite=answer)).rewrite(text, before, "Showing it."))

    def test_the_previous_request_supplies_the_action(self):
        d = self.rewrite({"resolved_request": "Show the whiteboard on the other screen"})
        self.assertEqual((d.kind, d.resolved_request), ("correction", "Show the whiteboard on the other screen"))

    def test_a_rewrite_identical_to_the_input_is_ignored(self):
        d = self.rewrite({"resolved_request": "ok wait, the other screen"})
        self.assertEqual((d.kind, d.source), ("none", "rejected"))

    def test_a_rewrite_with_words_nobody_said_is_ignored(self):
        d = self.rewrite({"resolved_request": "Delete the whiteboard on the other screen"})
        self.assertEqual((d.kind, d.source), ("none", "rejected"))

    def test_an_empty_or_broken_rewrite_is_ignored(self):
        self.assertEqual(self.rewrite({"resolved_request": ""}).kind, "none")
        self.assertEqual(self.rewrite("nonsense").kind, "none")


class RuleTests(unittest.TestCase):
    def test_the_no_no_rule_is_unchanged(self):
        for text in ("Tell me about yourself. No, no, no", "Turn on the lights, no no", "forget it", "Turn on the lights, scratch that"):
            self.assertEqual(rr.deterministic(text).kind, "cancel", text)
        for text in ("Tell me about yourself", "Tell me about yourself. No"):
            self.assertIsNone(rr.deterministic(text), text)


if __name__ == "__main__":
    unittest.main()
