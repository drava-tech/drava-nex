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
            q = pending.question(p, NAMES)
            self.assertTrue(q.startswith("Which light, and what brightness from 0 to 100 percent?"), q)
            for name in NAMES:
                self.assertIn(name, q)  # the choices are listed: nobody has to remember the names

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


class PendingEdgeTests(unittest.TestCase):
    """2026-10-06: a new request about something else was swallowed as the answer to a brightness question."""

    def setUp(self):
        self.a = _agent()
        self.a._pending = None

    def say(self, text):
        self.a.said.clear()
        asyncio.run(self.a._run_command(text))
        return " ".join(self.a.said)

    def test_an_ac_request_with_a_number_is_not_a_brightness_answer(self):
        self.say("make it dimmer")
        self.assertIsNotNone(self.a._pending)
        self.say("I want the AC colder, say 20")
        self.assertNotIn("Which light, to 20 percent", " ".join(self.a.said))
        self.assertIsNone(self.a._pending)

    def test_in_here_means_every_light(self):
        p = seed("make it a bit darker in here")
        self.assertEqual(p.name, pending.ALL)
        self.assertIn("What brightness for the lights", pending.question(p, NAMES))

    def test_full_and_half_answer_a_level_question(self):
        p = pending.Pending(name="tusker edge")
        fill(p, "half")
        self.assertEqual(p.level, 50)
        p = pending.Pending(name="tusker edge")
        fill(p, "full")
        self.assertEqual(p.level, 100)


class TrailingRetractionTests(unittest.TestCase):
    def test_a_request_taken_back_at_the_end_is_a_retraction(self):
        from nlu.repairs import ends_with_retraction

        for text in ("Tell me about yourself. No, no, no", "Tell me about yourself. No, no, no.", "Turn on the lights, no no", "Tell me about white tusker, never mind",
                     "Turn off tusker edge, forget it.", "Show the presentation, cancel that",
                     "Lock the door, nahi nahi", "Lock the door nahin nahin", "Open it, nai nai", "Show the film, na na", "Lock the door, rehne do", "Lock the door chhod do"):
            self.assertTrue(ends_with_retraction(text), text)

    def test_ordinary_sentences_are_not(self):
        from nlu.repairs import ends_with_retraction

        for text in ("No", "No, no, no", "Do you have a showroom, no", "Tell me about yourself", "Is there no other way to do it", "Never mind", "Turn on the lights", "Lock the door, nahi", "Tell me about yourself na", "Tell me about yourself, no?",
                     "Tell me about White Tusker"):
            self.assertFalse(ends_with_retraction(text), text)
