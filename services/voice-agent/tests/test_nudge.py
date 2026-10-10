"""The "Yes? What can I do for you?" prompt must not cut in while the user's command is being read
(log of 2026-10-06: it fired before Whisper returned 'Hey Travis, hi', then Travis answered anyway)."""

import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from tests.test_local_agent import _agent  # noqa: E402


def _waiting_agent():
    a = _agent()
    a._awake = True
    a._exchange_active = False
    a._nudge_state = "none"
    a._heard_command_speech = False
    a._last_voiced_at = 0.0
    a._awake_until = 1000.0
    a._utterance_inflight = 0
    return a


class NudgeTests(unittest.TestCase):
    def test_silence_after_just_the_wake_word_still_nudges(self):
        a = _waiting_agent()
        self.assertEqual(a._awake_action(now=3.0, busy=False), "nudge")

    def test_no_nudge_while_whisper_is_reading_the_command(self):
        a = _waiting_agent()
        a._utterance_inflight = 1  # the VAD cut an utterance; transcription not finished
        self.assertIsNone(a._awake_action(now=10.0, busy=False))
        a._utterance_inflight = 0
        self.assertEqual(a._awake_action(now=10.0, busy=False), "nudge")

    def test_no_nudge_while_the_user_is_still_talking(self):
        a = _waiting_agent()
        a._endpointer._in_speech = True
        self.assertIsNone(a._awake_action(now=10.0, busy=False))

    def test_the_awake_timer_does_not_close_the_mic_mid_command(self):
        a = _waiting_agent()
        a._awake_until = 5.0
        a._heard_command_speech = True  # a command is under way
        a._utterance_inflight = 1
        self.assertIsNone(a._awake_action(now=9.0, busy=False))
        a._utterance_inflight = 0
        self.assertEqual(a._awake_action(now=9.0, busy=False), "standby")

    def test_no_nudge_once_a_command_was_heard(self):
        a = _waiting_agent()
        a._heard_command_speech = True
        self.assertIsNone(a._awake_action(now=3.0, busy=False))


if __name__ == "__main__":
    unittest.main()
