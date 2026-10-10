"""Self-repair through the real turn handler (TravisLocal._run_command), the model mocked: take-backs, corrections and tag questions are settled BEFORE
anything is understood or run, a cancelled request fires nothing, and a plain turn never touches the model."""

import asyncio
import sys
import time
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from tests.test_planner import _planned  # noqa: E402
from tests.test_repair_resolver import FakeLLM  # noqa: E402

INTRO = "I'm Travis"
CANCELLED = "Okay, nothing changed."


def agent(classify=None, rewrite=None, delay=0.0, timeout_ms=700):
    """A turn handler with the repair resolver on and a fake model behind it. A request that reaches the planner is recorded, not run."""
    a = _planned("x")
    llm = FakeLLM(classify=classify, rewrite=rewrite, delay=delay)
    a._init_repair(llm, {"repair_timeout_ms": timeout_ms})
    a.llm, a.planned = llm, []

    async def run_plan(request, fallback):
        a.planned.append(request)
        await a._say(f"planned: {request}")
        return "planned"

    a._run_plan = run_plan
    return a


def turn(a, text):
    a.said.clear()
    started = time.perf_counter()
    asyncio.run(a._run_command(text))
    return (time.perf_counter() - started) * 1000


def said(a):
    return " ".join(a.said)


class FourExamplesTests(unittest.TestCase):
    def test_a_trailing_no_after_an_information_question_gives_the_answer(self):
        a = agent()
        turn(a, "Tell me about yourself. No")
        self.assertIn(INTRO, said(a))
        self.assertEqual(a.llm.calls, [])  # settled in code

    def test_a_tag_question_means_please_tell_me_not_cancel(self):
        a = agent()
        turn(a, "Tell me about yourself, no?")
        self.assertIn(INTRO, said(a))
        self.assertNotIn(CANCELLED, said(a))
        self.assertEqual(a.llm.calls, [])

    def test_scratch_that_cancels(self):
        a = agent()
        turn(a, "Turn on the lights, scratch that")
        self.assertEqual(said(a), CANCELLED)
        self.assertEqual(a.calls, [])

    def test_actually_the_fan_acts_on_the_fan(self):
        a = agent()
        turn(a, "Turn on the lights, actually the fan")
        self.assertEqual(a._utterance, "Turn on the fan")
        self.assertEqual(a.llm.calls, [])  # composed in code from the two halves


class MoreCasesTests(unittest.TestCase):
    def test_na_is_a_tag_question(self):
        a = agent()
        turn(a, "Tell me about yourself na")
        self.assertIn(INTRO, said(a))
        self.assertEqual(a.llm.calls, [])

    def test_a_correction_the_code_cannot_compose_asks_the_model_for_a_rewrite(self):
        a = agent(classify={"kind": "correction", "confidence": 0.9}, rewrite={"resolved_request": "Book room 3 for Wednesday"})
        turn(a, "Book room 3 for Tuesday, I mean Wednesday")
        self.assertEqual(a.planned, ["Book room 3 for Wednesday"])
        self.assertEqual(len(a.llm.calls), 2)  # classify, then rewrite
        self.assertEqual(a._repair_log["kind"], "correction")

    def test_no_projector_is_just_a_sentence_with_a_no_in_it(self):
        a = agent(classify={"kind": "none", "confidence": 0.95})
        turn(a, "There's no projector here, can you check")
        self.assertEqual(a.planned, ["There's no projector here, can you check"])  # unchanged
        self.assertEqual(len(a.llm.calls), 1)

    def test_forget_it_cancels_with_the_rule_and_no_model(self):
        a = agent()
        turn(a, "forget it")
        self.assertEqual(said(a), CANCELLED)
        self.assertEqual(a.llm.calls, [])

    def test_the_other_screen_means_the_previous_request_on_another_screen(self):
        a = agent(classify={"kind": "correction", "confidence": 0.9}, rewrite={"resolved_request": "Show the whiteboard on the other screen"})
        a._remember_turn("Show the whiteboard", "Showing the whiteboard on tusker 86.")
        turn(a, "ok wait, the other screen")
        self.assertEqual(a.planned, ["Show the whiteboard on the other screen"])
        self.assertIn("Show the whiteboard", a.llm.calls[0][0][1]["content"])  # the previous request reached the model
        self.assertIn("Showing the whiteboard on tusker 86.", a.llm.calls[0][0][1]["content"])  # and Travis's previous reply

    def test_a_rewrite_identical_to_the_input_changes_nothing(self):
        a = agent(classify={"kind": "correction", "confidence": 0.9}, rewrite={"resolved_request": "Oops, switch it"})
        turn(a, "Oops, switch it")
        self.assertEqual(a.planned, ["Oops, switch it"])


class NoSideEffectTests(unittest.TestCase):
    def test_a_cancelled_utterance_fires_nothing(self):
        for text, classify in (("Turn on tusker edge, scratch that", None), ("Turn on tusker edge, no, no", None), ("Turn on tusker edge, nahi nahi", None),
                               ("Turn on tusker edge, oops not that one", {"kind": "cancel", "confidence": 0.9})):
            a = agent(classify=classify)
            turn(a, text)
            self.assertEqual(a.calls, [], text)  # nothing reached the CMS
            self.assertEqual(said(a), CANCELLED, text)

    def test_hindi_double_negatives_cancel_in_code_without_the_model(self):
        for text in ("Lock the door, nahi nahi", "Lock the door nahin nahin", "Lock the door, nai nai", "Lock the door, na na", "Lock the door, rehne do"):
            a = agent(classify={"kind": "none", "confidence": 0.9})
            turn(a, text)
            self.assertEqual(a.calls, [], text)
            self.assertEqual(said(a), CANCELLED, text)
            self.assertEqual(a.llm.calls, [], text)  # the rule, not the model

    def test_a_single_nahi_or_na_is_not_a_cancel(self):
        a = agent(classify={"kind": "none", "confidence": 0.9})
        turn(a, "Tell me about yourself na")
        self.assertIn(INTRO, said(a))

    def test_the_same_request_without_the_take_back_does_run(self):
        a = agent()
        turn(a, "Turn on tusker edge")
        self.assertTrue(a.calls)

    def test_a_bare_no_after_a_device_action_asks_and_runs_nothing_until_confirmed(self):
        a = agent()
        turn(a, "Turn on tusker edge. No")
        self.assertEqual(a.calls, [])
        self.assertIn("stop, or go ahead", said(a))
        turn(a, "go ahead")
        self.assertTrue(a.calls)  # now it runs, through the normal action path

    def test_no_to_the_question_cancels(self):
        a = agent()
        turn(a, "Turn on tusker edge. No")
        turn(a, "stop")
        self.assertEqual(a.calls, [])

    def test_an_unclear_reading_asks(self):
        a = agent(classify={"kind": "cancel", "confidence": 0.3})
        turn(a, "Lock the door, hmm nahi")
        self.assertEqual(a.calls, [])
        self.assertIn("stop, or go ahead", said(a))


class PlainTurnsTests(unittest.TestCase):
    def test_plain_utterances_never_call_the_model(self):
        a = agent(classify={"kind": "cancel", "confidence": 1.0})
        for text in ("Tell me about yourself", "Turn on tusker edge", "Stop", "Show the whiteboard", "What is the CMS", "Make the room warmer", "Turn off the AC"):
            turn(a, text)
        self.assertEqual(a.llm.calls, [])
        self.assertIsNone(a._repair_log)

    def test_a_plain_turn_pays_microseconds_for_the_check(self):
        from nlu.repair_resolver import needs_resolver

        started = time.perf_counter()
        for _ in range(5000):
            needs_resolver("Tell me about yourself")
        self.assertLess((time.perf_counter() - started) / 5000 * 1000, 0.1)  # under 0.1 ms


class LatencyTests(unittest.TestCase):
    def test_a_cue_turn_costs_one_model_call_and_no_more(self):
        a = agent(classify={"kind": "none", "confidence": 0.9}, delay=0.2)
        ms = turn(a, "There's no projector here, can you check")
        self.assertGreaterEqual(ms, 190)  # it waited for the answer before anything ran
        self.assertLess(ms, 400)  # one 200 ms call, nothing else added

    def test_a_tag_question_costs_no_model_time_at_all(self):
        a = agent(classify={"kind": "none", "confidence": 0.9}, delay=0.5)
        ms = turn(a, "Tell me about yourself, no?")
        self.assertLess(ms, 100)

    def test_a_slow_resolver_times_out_and_the_turn_goes_on(self):
        a = agent(classify={"kind": "cancel", "confidence": 0.9}, delay=3.0, timeout_ms=150)
        ms = turn(a, "Turn on tusker edge, oops not that one")
        self.assertLess(ms, 900)  # not 3 s
        self.assertEqual(a.planned, ["Turn on tusker edge, oops not that one"])  # the raw request went on to the pipeline, as without the resolver
        self.assertEqual(a._repair_log["source"], "timeout")


if __name__ == "__main__":
    unittest.main()
