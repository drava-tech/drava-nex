"""The second round of 'don't guess' fixes: wake double-check, partial multi-action, gate rest-notice, new patterns."""

import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from safety.action_guard import ActionGuard  # noqa: E402
from nlu.command_matcher import load_registry, match_command, resolve  # noqa: E402
from nlu.multi_action import resolve_multi, resolve_parts  # noqa: E402
from nlu.relevance import is_room_command, parse_review  # noqa: E402
from safety.reply_guard import clean_cms_message  # noqa: E402
from speech.transcript_gate import addressed_to  # noqa: E402

REGISTRY = load_registry(AGENT_ROOT / "config" / "commands.json")
OPTS = dict(fuzzy=True, fuzzy_threshold=0.82, min_confidence=0.75)


class AddressedToTests(unittest.TestCase):
    def test_a_call_is_accepted(self):
        for t in ("Hey Travis, turn on the lights.", "Hey, Travis.", "A Travis lights on", "Travis, lights on",
                  "turn off tusker edge, hey Travis.", "Hey Tra vis lock the door",
                  "Travis turn on the spirits.", "Travis can I make sure?",
                  "Hey Chavis, turn off Tusker R1.", "He travels to turn off Tusker L1."):
            with self.subTest(t=t):
                self.assertTrue(addressed_to(t, "hey travis"))

    def test_a_mention_is_not(self):
        for t in ("Shrutha was talking to Travis yesterday.", "The Travis system is working well.", "I told Travis to wait outside.",
                  "We named the project Travis last year.", "Did you ask Travis about the lights?",
                  "Travis was saying we should increase the brightness.", "Is Travis working?"):
            with self.subTest(t=t):
                self.assertFalse(addressed_to(t, "hey travis"))


class PartialMultiActionTests(unittest.TestCase):
    def test_known_parts_are_split_from_unknown_ones(self):
        steps, left = resolve_parts("Unlock the door and turn on tusker L9.", REGISTRY, **OPTS)
        self.assertEqual([s.clause for s in steps], ["Unlock the door"])
        self.assertEqual(left, ["turn on tusker L9"])
        steps, left = resolve_parts("Set the AC to 24 and sing me a song", REGISTRY, **OPTS)
        self.assertEqual((len(steps), left), (1, ["sing me a song"]))

    def test_all_or_nothing_for_resolve_multi(self):
        self.assertIsNone(resolve_multi("Unlock the door and sing me a song", REGISTRY, **OPTS))

    def test_a_near_miss_next_to_an_unknown_part_is_left_to_the_model(self):
        # fuzzy matches are only trusted when every part is known
        steps, left = resolve_parts("lights of and sing me a song", REGISTRY, **OPTS)
        self.assertEqual(steps, [])  # nothing is run from the list: the model reads the whole sentence


class GateRestNoticeTests(unittest.TestCase):
    def test_a_dropped_filler_is_not_an_off_topic_part(self):
        for answer, cmd in (("KEEP: lock the door", "Close and lock the door"), ("KEEP: turn on the lights", "Turn it on"),
                            ("KEEP: set the AC to 22", "Set the AC to 22 and then")):
            with self.subTest(cmd=cmd):
                r = parse_review(answer, cmd)
                self.assertTrue(r.allowed)
                self.assertFalse(r.dropped)

    def test_a_dropped_off_topic_clause_still_counts(self):
        r = parse_review("KEEP: unlock the door", "unlock the door and tell me a joke")
        self.assertEqual((r.allowed, r.dropped, r.command), (True, True, "unlock the door"))

    def test_a_room_word_alone_does_not_skip_the_review(self):
        for t in ("Which TV should I buy for my living room?", "Is too much screen time bad for children?", "Play some music.",
                  "What's your favourite colour?", "Is the AC on?"):
            with self.subTest(t=t):
                self.assertFalse(is_room_command(t))
        for t in ("make the lights a bit brighter please", "can you dim tusker edge", "turn the volume up a bit"):
            with self.subTest(t=t):
                self.assertTrue(is_room_command(t))


class NewPatternTests(unittest.TestCase):
    def m(self, text):
        m = match_command(text, REGISTRY, **OPTS)
        return None if m is None else (m.intent, resolve(m).args)

    def test_switch_the_ac_on(self):
        self.assertEqual(self.m("Switch the air conditioner on.")[0], "AC_ON")
        self.assertEqual(self.m("turn the AC off")[0], "AC_OFF")

    def test_ac_fan_speed(self):
        self.assertEqual(self.m("Set the AC fan to high")[1]["params"], {"fan": "high"})
        self.assertEqual(self.m("fan medium")[1]["params"], {"fan": "mid"})
        self.assertIsNone(self.m("Set the AC fan to hurricane"))
        self.assertEqual([s.resolution.args["command"] for s in resolve_multi("Set the AC to cool mode, fan high.", REGISTRY, **OPTS)], ["set_mode", "set_fan"])

    def test_a_bare_number_is_not_an_ac_command(self):
        self.assertIsNone(self.m("set it to 24"))
        self.assertEqual(self.m("make it 24 degrees")[0], "AC_SET_TEMPERATURE")
        self.assertEqual(self.m("set 24 on the ac")[0], "AC_SET_TEMPERATURE")

    def test_the_main_screen_is_tusker_86(self):
        self.assertEqual(self.m("pause the main screen")[1]["screen"], "tusker 86")

    def test_turn_the_lights_to_a_level(self):
        a = self.m("turn the lights to 70 percent")[1]
        self.assertEqual((a["action"], a["brightness"]), ("lights_set", 70))


class RememberTheWholeGroupTests(unittest.TestCase):
    def test_them_after_a_plural_change_means_all_the_lights(self):
        g = ActionGuard(REGISTRY)
        g.remember("device_control", {"action": "lights_set", "target": "tusker L2", "brightness": 80}, True)
        g.remember_scope("light", "all lights")
        p = g.prepare("device_control", {"action": "lights_off", "target": "the lights"}, "turn them off", strict=True)
        self.assertEqual(p.calls, [("device_control", {"action": "all_lights_off"})])

    def test_an_expanded_request_reports_its_scope(self):
        p = ActionGuard(REGISTRY).prepare("device_control", {"action": "lights_set", "target": "lights", "brightness": 70}, "turn the lights to 70 percent", lambda: ["a", "b"], True)
        self.assertEqual(p.scope, "all lights")

    def test_a_spoken_out_of_range_volume_is_asked_about(self):
        p = ActionGuard(REGISTRY).prepare("device_control", {"action": "ac_command", "command": "Volume Up", "params": {"times": 6}},
                                          "turn the volume up by fifty", None, True)
        self.assertIn("1 to 10", p.question)
        p = ActionGuard(REGISTRY).prepare("device_control", {"action": "ac_command", "command": "Volume Up", "params": {"times": 6}},
                                          "turn the volume up a lot", None, True)
        self.assertIsNone(p.question)


class ApiWordingTests(unittest.TestCase):
    def test_a_raw_invalid_request_is_never_spoken(self):
        self.assertNotIn("Invalid request", clean_cms_message("Invalid request."))



class ArithmeticIsNotAJoinerTests(unittest.TestCase):
    def test_plus_does_not_split_a_sentence(self):
        from nlu.multi_action import split_clauses

        self.assertEqual(split_clauses("what's two plus two and turn off tusker L1"), ["what's two plus two", "turn off tusker L1"])
        steps, left = resolve_parts("What's two plus two and turn off tusker L1?", REGISTRY, **OPTS)
        self.assertEqual(len(steps), 1)
        self.assertEqual(left, ["What's two plus two"])


if __name__ == "__main__":
    unittest.main()
