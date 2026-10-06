import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from agent.base import TravisBase


class _FakeWakeModel:
    label = "travis"


def _agent(**state):
    """An agent that has just heard the wake word at t=0 (awake_timeout 15s)."""
    a = object.__new__(TravisBase)
    a._wake_model = _FakeWakeModel()
    a._awake = True
    a._awake_until = 15.0
    a._exchange_active = False
    a._exchange_is_nudge = False
    a._reply_complete_at = None
    a._last_model_activity = 0.0
    a._last_voiced_at = 0.0
    a._nudge_state = "none"
    a._heard_command_speech = False
    a._wake_confirmed = False
    for k, v in state.items():
        setattr(a, k, v)
    return a


class NudgeAfterSilenceTests(unittest.TestCase):
    def test_asks_after_two_seconds_of_silence_following_the_wake_word(self):
        a = _agent()
        self.assertIsNone(a._awake_action(1.9, busy=False))
        self.assertEqual(a._awake_action(2.0, busy=False), "nudge")

    def test_the_two_seconds_restart_while_the_user_keeps_talking(self):
        # A long command: voiced audio keeps arriving, so no nudge mid-sentence.
        a = _agent(_last_voiced_at=4.0)
        self.assertIsNone(a._awake_action(5.9, busy=False))
        self.assertEqual(a._awake_action(6.0, busy=False), "nudge")

    def test_no_nudge_once_the_user_has_started_talking(self):
        # Seen live: a quiet mic never registered as "voiced", so the nudge
        # fired mid-command and Travis answered twice.
        a = _agent(_heard_command_speech=True)
        self.assertIsNone(a._awake_action(5.0, busy=False))

    def test_only_asks_once_per_wake_word(self):
        a = _agent(_nudge_state="sent")
        self.assertIsNone(a._awake_action(10.0, busy=False))

    def test_gives_up_after_the_timeout_if_still_no_command(self):
        a = _agent(_nudge_state="done")
        self.assertIsNone(a._awake_action(14.9, busy=False))
        self.assertEqual(a._awake_action(15.0, busy=False), "standby")

    def test_never_nudges_while_busy(self):
        self.assertIsNone(_agent()._awake_action(5.0, busy=True))

    def test_keeps_the_mic_open_for_the_answer_once_the_prompt_is_spoken(self):
        a = _agent(
            _exchange_active=True,
            _exchange_is_nudge=True,
            _nudge_state="sent",
            _reply_complete_at=5.0,
            _last_model_activity=5.0,
        )
        self.assertEqual(a._awake_action(6.0, busy=False), "wait_for_command")


class CloseOnlyWhenTheWholeExchangeIsDoneTests(unittest.TestCase):
    def _answered(self, **state):
        base = dict(_exchange_active=True, _reply_complete_at=4.0, _last_model_activity=4.0)
        base.update(state)
        return _agent(**base)

    def test_closes_after_the_reply_is_complete_and_quiet(self):
        a = self._answered()
        self.assertEqual(a._awake_action(5.0, busy=False), "standby")

    def test_a_short_gap_in_playback_does_not_close_the_mic(self):
        a = self._answered(_last_model_activity=4.6)
        self.assertIsNone(a._awake_action(5.0, busy=False))  # only 0.4s quiet

    def test_does_not_close_while_a_sentence_is_still_being_spoken(self):
        self.assertIsNone(self._answered()._awake_action(5.0, busy=True))

    def test_does_not_close_while_a_command_is_still_running(self):
        # "Do A and B": the second tool call is still running / unanswered.
        self.assertIsNone(self._answered()._awake_action(9.0, busy=True))

    def test_a_reply_that_never_completed_keeps_the_mic_open(self):
        # turn_complete not seen (or cleared by a tool response / interruption).
        a = _agent(_exchange_active=True, _reply_complete_at=None, _last_model_activity=6.0)
        self.assertIsNone(a._awake_action(20.0, busy=False))

    def test_a_lost_turn_complete_cannot_hold_the_mic_open_forever(self):
        a = _agent(_exchange_active=True, _reply_complete_at=None)
        self.assertEqual(a._awake_action(15.0 + 30.0, busy=False), "standby")

    def test_asleep_or_without_a_detector_does_nothing(self):
        self.assertIsNone(_agent(_awake=False)._awake_action(99.0, busy=False))
        self.assertIsNone(_agent(_wake_model=None)._awake_action(99.0, busy=False))


if __name__ == "__main__":
    unittest.main()
