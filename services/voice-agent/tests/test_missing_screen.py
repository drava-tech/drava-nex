"""A push with no screen asks for the whole command again (log of 2026-10-06)."""

import asyncio
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.missing_target import missing_screen  # noqa: E402
from tests.test_local_agent import _agent  # noqa: E402

SCREENS = {"tusker 86", "tusker 27", "kiosk", "tv", "main screen"}


class DetectTests(unittest.TestCase):
    def test_the_logged_command(self):
        self.assertTrue(missing_screen("Push welcome screen to", SCREENS))

    def test_push_with_no_destination(self):
        self.assertTrue(missing_screen("push welcome screen", SCREENS))
        self.assertTrue(missing_screen("send the flight data art", SCREENS))

    def test_other_verbs_only_when_they_trail_off(self):
        self.assertTrue(missing_screen("show welcome screen on the", SCREENS))
        self.assertTrue(missing_screen("play flight data art on", SCREENS))
        self.assertFalse(missing_screen("show welcome screen", SCREENS))  # may not be a screen request
        self.assertFalse(missing_screen("play the video", SCREENS))

    def test_a_named_screen_is_not_missing(self):
        self.assertFalse(missing_screen("push welcome screen to tusker 86", SCREENS))
        self.assertFalse(missing_screen("push welcome screen to the kiosk", SCREENS))

    def test_a_screen_the_room_has_no_alias_for_is_left_to_the_cms(self):
        self.assertFalse(missing_screen("push welcome screen to facade", SCREENS))

    def test_other_requests_are_not_touched(self):
        self.assertFalse(missing_screen("turn on the lights", SCREENS))
        self.assertFalse(missing_screen("push", SCREENS))


class ExchangeTests(unittest.TestCase):
    def test_travis_asks_for_the_whole_command(self):
        a = _agent()
        a._pending = a._confirm = None
        a._screen_phrases = lambda: SCREENS
        asyncio.run(a._run_command("Push welcome screen to"))
        said = " ".join(a.said)
        self.assertIn("repeat the whole command", said)
        self.assertNotIn("Which screen", said)
        self.assertEqual(a.calls, [])
        self.assertEqual(a._llm.requests if hasattr(a._llm, "requests") else [], [])  # no model involved


if __name__ == "__main__":
    unittest.main()
