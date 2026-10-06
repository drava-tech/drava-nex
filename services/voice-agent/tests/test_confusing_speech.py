"""Hesitations, self-corrections, fragments and contradictions: act on the one clear thing, or ask."""

import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu import repairs  # noqa: E402
from nlu.command_matcher import load_registry, match_command, resolve  # noqa: E402
from nlu.local_llm import ToolCall  # noqa: E402
from nlu.multi_action import is_fragment, is_pleasantry, resolve_parts, split_clauses  # noqa: E402
from nlu.relevance import RelevanceGate  # noqa: E402
from tests.test_local_agent import _agent, _FakeLLM, _hear, _with_messages  # noqa: E402

REGISTRY = load_registry(AGENT_ROOT / "config" / "commands.json")
OPTS = dict(fuzzy=True, fuzzy_threshold=0.82, min_confidence=0.75)


class HelperTests(unittest.TestCase):
    def test_hesitation_phrases_are_removed(self):
        self.assertEqual(repairs.strip_hesitations("Turn the, what do you call it, tusker L1 on."), "Turn the, tusker L1 on.")
        self.assertEqual(repairs.strip_hesitations("Switch on tusker L1 and, uh, what was it, tusker L2."), "Switch on tusker L1 and, uh, tusker L2.")
        self.assertEqual(repairs.strip_hesitations("turn on the lights"), "turn on the lights")

    def test_a_bare_verb_joins_the_next_part(self):
        self.assertEqual(split_clauses("Turn the, tusker L1 on."), ["Turn the tusker L1 on"])
        self.assertEqual(split_clauses("Lock the door, then turn on tusker edge"), ["Lock the door", "turn on tusker edge"])

    def test_pleasantries_are_not_requests(self):
        for c in ("Thanks Travis", "okay", "thank you", "please", "uh"):
            self.assertTrue(is_pleasantry(c), c)
        self.assertFalse(is_pleasantry("tell me a joke"))

    def test_polarity_words_and_numbers_alone_are_fragments(self):
        for c in ("off", "on", "28", "28 degrees", "up"):
            self.assertTrue(is_fragment(c), c)
        for c in ("turn off tusker edge", "tusker edge"):
            self.assertFalse(is_fragment(c), c)

    def test_the_correction_is_split_into_what_they_said_and_what_they_meant(self):
        self.assertEqual(repairs.split_correction("Set the AC to 24, no wait, 22."), ("Set the AC to 24", "22"))
        self.assertEqual(repairs.split_correction("Switch the lights off, or actually just tusker edge."), ("Switch the lights off", "just tusker edge"))
        self.assertIsNone(repairs.split_correction("turn on the lights"))
        # a marker that only opens the sentence: what follows it is the request
        self.assertEqual(repairs.last_version("Hold on, turn on tusker edge."), "turn on tusker edge")
        self.assertIsNone(repairs.last_version("Hold on, hold on"))

    def test_a_pleasantry_before_a_command_is_ignored(self):
        steps, left = resolve_parts("Thanks Travis, now turn off tusker edge.", REGISTRY, **OPTS)
        self.assertEqual(len(steps), 1)
        self.assertEqual(left, [])


class MultiCallCommandTests(unittest.TestCase):
    def test_heat_mode_at_21_degrees_is_two_calls(self):
        m = match_command("Set the AC to heat mode at 21 degrees.", REGISTRY, **OPTS)
        self.assertEqual(m.intent, "AC_MODE_AND_TEMPERATURE")
        r = resolve(m)
        self.assertEqual((r.args["command"], r.args["params"]), ("set_mode", {"mode": "heat"}))
        self.assertEqual([(t, a["command"], a["params"]) for t, a in r.also], [("device_control", "set_temp", {"temp": 21})])

    def test_it_is_run_as_two_actions_and_both_are_reported(self):
        a = _agent("Hey Travis set the AC to heat mode at 21 degrees")
        _with_messages(a, {})
        _hear(a)
        self.assertEqual([c[1]["command"] for c in a.calls], ["set_mode", "set_temp"])
        self.assertEqual(" ".join(a.said), "AC set to heat mode. AC set to 21 degrees.")


class AskedNotRunTests(unittest.TestCase):
    def run_cmd(self, heard, **kw):
        a = _agent(heard, **kw)
        _with_messages(a, {})
        _hear(a)
        return a

    def test_on_and_off_in_one_breath_asks(self):
        a = self.run_cmd("Hey Travis turn the lights on and off")
        self.assertEqual(a.calls, [])  # not even the first half
        self.assertIn('"off"', " ".join(a.said))
        self.assertIn("Say Hey Travis, then your answer.", " ".join(a.said))

    def test_two_temperatures_asks(self):
        a = self.run_cmd("Hey Travis set the AC to 20 and 28")
        self.assertEqual(a.calls, [])
        self.assertIn("Which one do you want?", " ".join(a.said))

    def test_forget_it_cancels_even_with_more_words(self):
        a = self.run_cmd("Hey Travis forget it I'll do it later")
        self.assertEqual(a.calls, [])
        self.assertEqual(" ".join(a.said), "Okay, nothing changed.")

    def test_thanks_before_a_command_does_not_get_declined(self):
        a = self.run_cmd("Hey Travis thanks now turn off tusker edge")
        self.assertEqual([c[1]["action"] for c in a.calls], ["lights_off"])
        self.assertNotIn("Sorry", " ".join(a.said))

    def test_a_hesitation_phrase_is_not_a_pronoun(self):
        a = self.run_cmd("Hey Travis turn the, what do you call it, tusker L1 on")
        self.assertEqual([(c[1]["action"], c[1]["target"]) for c in a.calls], [("lights_on", "tusker L1")])


class CorrectionToTheModelTests(unittest.TestCase):
    def test_the_model_is_told_which_version_counts(self):
        llm = _FakeLLM([("tool_calls", [ToolCall("device_control", {"action": "lights_off", "target": "tusker edge"})])])
        a = _agent("Hey Travis switch the lights off or actually just tusker edge", _llm=llm)
        _with_messages(a, {"lights_off": "tusker edge is off."})
        _hear(a)
        sent = llm.requests[0][-1]["content"]
        self.assertIn("they corrected themselves: just tusker edge", sent)
        self.assertIn("Do only the corrected request", sent)
        self.assertEqual([c[1]["target"] for c in a.calls], ["tusker edge"])
        self.assertNotIn("the rest", " ".join(a.said))  # a correction is not an off-topic part

    def test_a_corrected_sentence_is_never_trimmed_by_the_gate(self):
        class Chat:
            async def complete(self, messages, max_tokens=4):
                return "KEEP: tusker L2"

        gate = RelevanceGate(Chat())
        import asyncio

        r = asyncio.run(gate.review("Turn on tusker L1 no wait tusker L2 please maybe", None, corrected=True))
        self.assertEqual((r.allowed, r.dropped), (True, False))


if __name__ == "__main__":
    unittest.main()
