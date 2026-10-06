"""A half-finished brightness request is finished by the answer to Travis's question
(replays the 2026-10-05 log: dim -> which light -> L3 -> level)."""

import asyncio
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu import pending  # noqa: E402
from safety.action_guard import ActionGuard  # noqa: E402
from safety.reply_guard import invents_number  # noqa: E402
from tests.test_local_agent import REGISTRY, _FakeLLM, _agent  # noqa: E402

GUARD = ActionGuard(REGISTRY)
NAMES = GUARD.light_names
ALIASES = GUARD._aliases


def seed(text):
    return pending.seed(text, NAMES, ALIASES)


def fill(p, text):
    return pending.fill(p, text, NAMES, ALIASES)


class SlotTests(unittest.TestCase):
    def test_a_vague_dim_asks_for_light_and_level(self):
        for text in ("Feels like it too bright. Can you reduce", "I want dim the light", "make it dimmer"):
            p = seed(text)
            self.assertIsNotNone(p, text)
            self.assertEqual(pending.question(p, NAMES), "Which light, and what brightness from 0 to 100 percent?")

    def test_other_requests_are_not_brightness(self):
        for text in ("increase the volume", "lower the AC to 22", "turn on the light", "what time is it"):
            self.assertIsNone(seed(text), text)

    def test_answers_fill_one_slot_each(self):
        p = seed("I want dim the light")
        self.assertTrue(fill(p, "I need at least 10% of current status"))
        self.assertEqual((p.name, p.level), (None, 10))
        self.assertIn("Which light, to 10 percent", pending.question(p, NAMES))
        self.assertTrue(fill(p, "A radius L3"))
        self.assertEqual((p.name, p.level), ("tusker L3", 10))
        self.assertIsNone(pending.question(p, NAMES))

    def test_mis_heard_short_name(self):
        p = pending.Pending()
        self.assertTrue(fill(p, "Reduce in 3 to 10 percent"))
        self.assertEqual((p.name, p.level), ("tusker L3", 10))

    def test_l3_is_never_l1(self):
        p = pending.Pending()
        fill(p, "tusker l3")
        self.assertEqual(p.name, "tusker L3")

    def test_reduce_by_a_number_is_asked_not_computed(self):
        p = pending.Pending()
        fill(p, "I want to reduce 70%")
        self.assertEqual((p.level, p.ambiguous), (None, 70))
        self.assertIn("70", pending.question(p, NAMES))

    def test_out_of_range(self):
        p = pending.Pending(name="tusker L1")
        fill(p, "150 percent")
        self.assertIn("0 to 100", pending.question(p, NAMES))

    def test_the_lights_means_all(self):
        p = seed("dim the lights")
        self.assertEqual(p.name, pending.ALL)

    def test_yes_no(self):
        self.assertTrue(pending.is_yes_no("Yes"))
        self.assertTrue(pending.is_no("no"))
        self.assertFalse(pending.is_yes_no("turn on the lights"))


class InventedNumberTests(unittest.TestCase):
    def test_numbers_the_user_never_said(self):
        self.assertTrue(invents_number("I'll dim tusker L3 to 30% brightness.", {70.0}))
        self.assertFalse(invents_number("Dimming to 70%.", {70.0}))
        self.assertFalse(invents_number("There are 6 devices.", set()))


class ExchangeTests(unittest.TestCase):
    def setUp(self):
        self.a = _agent()
        self.a._pending = None

    def say(self, text):
        self.a.said.clear()
        asyncio.run(self.a._run_command(text))
        return " ".join(self.a.said)

    def test_the_logged_conversation(self):
        a = self.a
        self.assertIn("Which light, and what brightness", self.say("Feels like it too bright. Can you reduce"))
        self.assertIn("Which light, to 10 percent", self.say("I need at least 10% of current status"))
        self.assertEqual(a.calls, [])
        self.say("A radius L3")
        self.assertEqual(a.calls, [("device_control", {"action": "lights_set", "target": "tusker L3", "brightness": 10})])
        self.assertIsNone(a._pending)

    def test_reduce_70_asks_and_a_plain_level_finishes(self):
        a = self.a
        self.say("I want dim tusker L3")
        self.assertIn("Is 70 the new brightness", self.say("I want to reduce 70%"))
        self.assertEqual(a.calls, [])
        self.say("30 percent")
        self.assertEqual(a.calls, [("device_control", {"action": "lights_set", "target": "tusker L3", "brightness": 30})])

    def test_a_new_command_drops_the_question(self):
        a = self.a
        self.say("make it dimmer")
        self.say("turn on tusker edge")
        self.assertEqual(a.calls, [("device_control", {"action": "lights_on", "target": "tusker edge"})])
        self.assertIsNone(a._pending)

    def test_no_cancels(self):
        self.say("make it dimmer")
        self.assertIn("left it as it is", self.say("no"))
        self.assertIsNone(self.a._pending)

    def test_a_bare_yes_with_nothing_waiting(self):
        reply = self.say("Yes")
        self.assertIn("not waiting", reply)
        self.assertEqual(self.a.calls, [])

    def test_the_question_lapses(self):
        self.say("make it dimmer")
        self.a._pending.expires = 0.0
        self.say("tusker L3")
        self.assertEqual(self.a.calls, [])

    def test_a_model_made_up_level_is_not_spoken(self):
        a = _agent()
        a._llm = _FakeLLM([("text", "I'll dim tusker L3 to 30%. Is that correct?")])
        a._utterance = "something about 70 percent"
        out = asyncio.run(a._speak_checked("I'll dim tusker L3 to 30%. Is that correct?", []))
        self.assertIn("I haven't changed anything", out)

    def test_a_one_word_fragment_is_not_off_topic(self):
        from nlu.relevance import Review
        from tests.test_local_agent import _FakeGate

        a = _agent(_gate=_FakeGate(Review(False, "")))
        a._pending = None
        asyncio.run(a._run_command("I won"))
        self.assertEqual(a.said, ["Sorry, I didn't catch that."])


if __name__ == "__main__":
    unittest.main()
