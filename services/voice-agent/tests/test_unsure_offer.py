"""When Whisper is not sure of a sentence that still reads as a clear room request, Travis asks "Did you mean ...?" and acts only on a yes
(agent/commands.py `_offer_guess`, nlu/describe.py). A visitor never has to know the wording: they say yes or no."""

import asyncio
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.describe import say_calls  # noqa: E402
from tests.test_local_agent import _agent, _hear  # noqa: E402


def _unsure(command: str, logprob: float | None = -0.6):
    a = _agent()
    a._pending = a._confirm = None
    asyncio.run(a._run_command(command, unsure=True, heard_logprob=logprob))
    return a


class DescribeTests(unittest.TestCase):
    def test_lights(self):
        self.assertEqual(say_calls([("device_control", {"action": "all_lights_on"})]), "turn on all the lights")
        self.assertEqual(say_calls([("device_control", {"action": "lights_off", "target": "tusker edge"})]), "turn off the cove light")
        self.assertEqual(say_calls([("device_control", {"action": "lights_set", "target": "tusker L3", "brightness": 50})]), "set the sky light to 50 percent")

    def test_ac_and_volume(self):
        self.assertEqual(say_calls([("device_control", {"action": "ac_command", "command": "power_on"})]), "turn on the AC")
        self.assertEqual(say_calls([("device_control", {"action": "ac_command", "command": "set_temp", "params": {"temp": 24}})]), "set the AC to 24 degrees")
        self.assertEqual(say_calls([("device_control", {"action": "ac_command", "command": "Volume Up"})]), "turn the volume up")

    def test_several_calls_are_joined(self):
        calls = [("device_control", {"action": "lights_off", "target": "tusker edge"}), ("device_control", {"action": "all_lights_on"})]
        self.assertEqual(say_calls(calls), "turn off the cove light and turn on all the lights")

    def test_anything_it_cannot_say_plainly_gives_none(self):
        self.assertIsNone(say_calls([]))
        self.assertIsNone(say_calls([("device_control", {"action": "lights_set", "target": "tusker edge"})]))  # no level, no colour
        self.assertIsNone(say_calls([("device_control", {"action": "good_morning"})]))
        self.assertIsNone(say_calls([("device_control", {"action": "all_lights_on"}), ("device_control", {"action": "good_morning"})]))


class OfferTests(unittest.TestCase):
    def test_a_clear_request_heard_unsurely_is_offered_not_run(self):
        a = _unsure("turn on all the lights")
        self.assertEqual(a.calls, [])
        self.assertIn("Did you mean turn on all the lights?", " ".join(a.said))
        self.assertTrue(a._confirm is not None and a._confirm.offer and a._confirm.current.kind == "command")
        self.assertEqual(a._path, "declined (offered a guess)")
        self.assertEqual(a._history, [])  # still not kept as conversation

    def test_yes_runs_exactly_what_was_offered(self):
        a = _unsure("turn on all the lights")
        b = _agent("Hey Travis, yes", _confirm=a._confirm)
        b._guard = a._guard
        _hear(b)
        self.assertEqual(b.calls, [("device_control", {"action": "all_lights_on"})])

    def test_no_runs_nothing(self):
        a = _unsure("turn on all the lights")
        b = _agent("Hey Travis, no", _confirm=a._confirm)
        _hear(b)
        self.assertEqual(b.calls, [])

    def test_a_score_closer_to_noise_than_to_a_misheard_sentence_is_not_guessed_at(self):
        a = _unsure("turn on all the lights", logprob=-1.3)
        self.assertEqual(a.calls, [])
        self.assertIsNone(a._confirm)
        self.assertIn("not sure I heard that right", " ".join(a.said))

    def test_a_door_is_never_offered(self):
        for text in ("unlock the door", "lock the door"):
            with self.subTest(text):
                a = _unsure(text)
                self.assertEqual(a.calls, [])
                self.assertIsNone(a._confirm)
                self.assertNotIn("Did you mean", " ".join(a.said))

    def test_something_that_is_not_a_room_request_asks_again(self):
        a = _unsure("tell me about the weather")
        self.assertIsNone(a._confirm)
        self.assertIn("not sure I heard that right", " ".join(a.said))

    def test_an_unfinished_sentence_keeps_its_own_message(self):
        a = _agent()
        a._pending = a._confirm = None
        asyncio.run(a._run_command("turn on the", unsure=True, unfinished=True, heard_logprob=-0.6))
        self.assertIn("stopped mid-sentence", " ".join(a.said))
        self.assertIsNone(a._confirm)


if __name__ == "__main__":
    unittest.main()
