"""Questions about an action never run it (nlu/capability.py, agent/commands.py): answered, offered, and run only on a "yes"."""

import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.capability import classify, reply_text, touches_door  # noqa: E402
from tests.test_local_agent import _agent, _hear  # noqa: E402

QUESTIONS = [
    ("Can the CMS turn on the lights", "can", "turn on the lights"),
    ("can Travis switch off the lights", "can", "switch off the lights"),
    ("Can it turn on the AC", "can", "turn on the ac"),
    ("Could the CMS set the AC to 22", "can", "set the ac to 22"),
    ("Does Travis lock the door", "can", "lock the door"),
    ("Does it mute the TV", "can", "mute the tv"),
    ("Is it possible to dim the lights", "can", "dim the lights"),
    ("How do I turn on the lights", "howto", "turn on the lights"),
    ("How can I lock the door", "howto", "lock the door"),
    ("how does the CMS push content to a screen", "howto", "push content to a screen"),
    ("What happens if I turn off the lights", "happens", "turn off the lights"),
    ("Hey Travis, can the CMS turn on the lights?", "can", "turn on the lights"),
]
REQUESTS = [
    "Can you turn on the AC", "Could you lock the door", "would you dim the lights", "Will you turn it off", "Please turn on the lights",
    "Can I have the lights on", "can we have the AC on", "Turn on the lights", "do it", "Hey Travis, can you set the AC to 22",
    "I would like the lights on", "Lights on please",
]


class ClassifyTests(unittest.TestCase):
    def test_capability_and_how_to_questions_are_found(self):
        for text, kind, inner in QUESTIONS:
            with self.subTest(text):
                lead = classify(text)
                self.assertIsNotNone(lead)
                self.assertEqual((lead.kind, lead.inner), (kind, inner))

    def test_direct_requests_are_not_questions(self):
        for text in REQUESTS:
            with self.subTest(text):
                self.assertIsNone(classify(text))

    def test_pairs_differ_only_in_who_is_asked(self):
        for thing in ("the lights", "the AC", "the TV", "the main screen", "the door"):
            with self.subTest(thing):
                self.assertIsNone(classify(f"Can you turn on {thing}"))
                self.assertIsNotNone(classify(f"Can the CMS turn on {thing}"))

    def test_door_calls_are_recognised(self):
        self.assertTrue(touches_door([("device_control", {"action": "lock"})]))
        self.assertTrue(touches_door([("screen_control", {"action": "stop"}), ("device_control", {"action": "unlock"})]))
        self.assertFalse(touches_door([("device_control", {"action": "lights_on"})]))

    def test_the_reply_offers_except_for_the_door(self):
        lead = classify("Can the CMS turn on the lights")
        self.assertEqual(reply_text(lead, False), "Yes, I can do that. Would you like me to turn on the lights?")
        self.assertEqual(reply_text(classify("Can the CMS unlock the door"), True), "Yes, I can do that.")
        self.assertNotIn("Would you like", reply_text(classify("How do I lock the door"), True))
        self.assertEqual(reply_text(classify("What happens if I turn off the lights"), False), "I can turn them off for you. Would you like me to?")
        self.assertEqual(reply_text(classify("What happens if I turn on the AC"), False), "I can turn it on for you. Would you like me to?")
        self.assertEqual(reply_text(classify("What happens if I set the AC to 22"), False), "I can set the ac to 22 for you. Would you like me to?")
        self.assertNotIn("Would you like", reply_text(classify("What happens if I unlock the door"), True))


class AgentTests(unittest.TestCase):
    def test_a_question_about_an_action_is_offered_not_run(self):
        a = _agent("Hey Travis, can the CMS turn on the lights")
        _hear(a)
        self.assertEqual(a.calls, [])
        self.assertIn("Would you like me to turn on the lights?", " ".join(a.said))
        self.assertTrue(a._confirm is not None and a._confirm.offer and a._confirm.current.kind == "command")

    def test_yes_runs_exactly_the_offered_command(self):
        a = _agent("Hey Travis, can the CMS turn on the lights")
        _hear(a)
        self.assertEqual(a.calls, [])
        b = _agent("Hey Travis, yes", _confirm=a._confirm)
        b._guard = a._guard
        _hear(b)
        self.assertTrue(b.calls and b.calls[0][0] == "device_control")
        self.assertIn("lights_on", str(b.calls[0][1]) + str(b.calls))

    def test_no_drops_the_offer_and_runs_nothing(self):
        a = _agent("Hey Travis, how do I turn on the lights")
        _hear(a)
        b = _agent("Hey Travis, no thanks", _confirm=a._confirm)
        _hear(b)
        self.assertEqual(b.calls, [])
        self.assertFalse(b._portfolio_declined)  # that flag belongs to the portfolio offer

    def test_a_door_question_is_answered_without_an_offer(self):
        for text in ("Does the CMS unlock the door", "Can Travis lock the door", "How do I unlock the door"):
            with self.subTest(text):
                a = _agent("Hey Travis, " + text)
                _hear(a)
                self.assertEqual(a.calls, [])
                self.assertIsNone(a._confirm)
                self.assertNotIn("Would you like", " ".join(a.said))

    def test_a_polite_request_still_runs(self):
        for text in ("can you turn on tusker edge", "could you turn on tusker edge", "please turn on tusker edge"):
            with self.subTest(text):
                a = _agent("Hey Travis, " + text)
                _hear(a)
                self.assertTrue(a.calls and a.calls[0][0] == "device_control")

    def test_actuation_is_blocked_while_a_question_is_answered(self):
        from agent.local import TravisLocal

        a = _agent("x")
        a._question_mode = True
        a._call_tool = TravisLocal._call_tool.__get__(a)  # the real one, not the test double
        import asyncio

        ok, message = asyncio.run(a._call_tool("device_control", {"action": "lights_on", "target": "tusker edge"}))
        self.assertFalse(ok)
        self.assertIn("question", message)


if __name__ == "__main__":
    unittest.main()
