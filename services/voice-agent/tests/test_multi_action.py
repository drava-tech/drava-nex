"""Several actions in one sentence: split, matched exactly, all-or-nothing."""

import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu import repairs  # noqa: E402
from nlu.command_matcher import load_registry, match_command  # noqa: E402
from nlu.multi_action import resolve_multi, split_clauses  # noqa: E402

REGISTRY = load_registry(AGENT_ROOT / "config" / "commands.json")
OPTS = dict(fuzzy=True, fuzzy_threshold=0.82, min_confidence=0.75)


def steps(text):
    r = resolve_multi(text, REGISTRY, **OPTS)
    return None if r is None else [(s.resolution.tool, s.resolution.args) for s in r]


def dev(**a):
    return ("device_control", a)


class SplitTests(unittest.TestCase):
    def test_splits_on_joiners_and_commas(self):
        self.assertEqual(split_clauses("Set the AC to 24, turn off tusker edge, and lock the door."),
                         ["Set the AC to 24", "turn off tusker edge", "lock the door"])
        self.assertEqual(split_clauses("volume up and then mute"), ["volume up", "mute"])

    def test_a_single_command_is_not_multi(self):
        self.assertIsNone(steps("turn on tusker edge"))


class MultiActionTests(unittest.TestCase):
    def test_two_and_three_actions_in_order(self):
        self.assertEqual(steps("Set the AC to 24 and turn on tusker edge."), [
            dev(action="ac_command", target="ac", command="set_temp", params={"temp": 24}),
            dev(action="lights_on", target="tusker edge")])
        self.assertEqual([a[1]["action"] for a in steps("Set the AC to 23, turn off tusker edge, and lock the door.")],
                         ["ac_command", "lights_off", "lock"])

    def test_a_bare_name_borrows_the_verb(self):
        self.assertEqual([a[1] for a in steps("Turn on tusker L1 and tusker L2.")],
                         [{"action": "lights_on", "target": "tusker L1"}, {"action": "lights_on", "target": "tusker L2"}])
        self.assertEqual([(a[1]["action"], a[1]["target"]) for a in steps("Turn off tusker L1, tusker L2 and tusker edge.")],
                         [("lights_off", "tusker L1"), ("lights_off", "tusker L2"), ("lights_off", "tusker edge")])

    def test_the_borrowed_verb_keeps_its_polarity(self):
        # "off" must not become "on" (the fuzzy near-miss that used to happen)
        self.assertEqual([a[1]["action"] for a in steps("Turn off the AC and all the lights.")], ["ac_command", "all_lights_off"])

    def test_a_pronoun_takes_the_previous_name(self):
        got = steps("Dim tusker L3 to 40 percent and make it warm white.")
        self.assertEqual([(a[1]["action"], a[1]["target"]) for a in got], [("lights_set", "tusker L3"), ("lights_set", "tusker L3")])
        self.assertEqual(got[1][1]["color"], "warm white")

    def test_the_old_swallowing_bug(self):
        # "{target} lights on" used to swallow "set the AC to 24 and turn the lights" into one name
        self.assertEqual([a[1]["action"] for a in steps("Set the AC to 24 and turn the lights on.")], ["ac_command", "all_lights_on"])
        self.assertIsNone(match_command("Set the AC to 24 and turn the lights on.", REGISTRY, **OPTS))

    def test_content_on_two_screens(self):
        got = steps("Show the flight simulation on tusker 27 and the company presentation on tusker 86.")
        self.assertEqual([(a[1]["content"], a[1]["screen"]) for a in got],
                         [("flight simulation", "tusker 27"), ("company presentation", "tusker 86")])

    def test_one_unknown_part_sends_everything_to_the_model(self):
        for text in ("Set the AC to 24 and increase the brightness to 80.", "Set the AC to 24 and what's the capital of France",
                     "Set the AC to 24 and sing me a song"):
            with self.subTest(text=text):
                self.assertIsNone(steps(text))

    def test_shutdown_is_never_chained(self):
        self.assertIsNone(steps("Shut down and turn off the lights."))
        self.assertIsNone(steps("turn off the lights and shut down"))

    def test_hesitation_alone_is_not_a_part(self):
        self.assertEqual([a[1]["action"] for a in steps("uh, set the AC to 24 and turn on tusker edge")], ["ac_command", "lights_on"])


class MatcherDoesNotGuess(unittest.TestCase):
    def m(self, text):
        return match_command(text, REGISTRY, **OPTS)

    def test_turn_it_on_is_not_volume_down(self):
        self.assertIsNone(self.m("Turn it on."))

    def test_a_trailing_value_is_not_dropped(self):
        self.assertIsNone(self.m("Set the AC fan to hurricane."))

    def test_polar_words_are_never_swapped(self):
        self.assertIsNone(self.m("turn off the tv lights up"))
        self.assertEqual(self.m("lights on").intent, "ALL_LIGHTS_ON")

    def test_filler_alternatives_do_not_vanish(self):
        # "to" is a filler: it used to vanish from "(on|onto|in|to)" and turn "play tusker 27" into content "tusker"
        self.assertEqual(self.m("play tusker 27").intent, "SCREEN_PLAY")
        self.assertEqual(self.m("send the welcome video to tusker 86").intent, "CONTENT_ON_SCREEN")

    def test_names_cannot_swallow_another_command(self):
        m = self.m("show the company presentation on tusker 86 and set the AC to 22")
        self.assertIsNone(m)


class SelfCorrectionTests(unittest.TestCase):
    def test_the_last_version_wins(self):
        self.assertEqual(repairs.last_version("turn on the lights, no wait, turn off the lights"), "turn off the lights")
        self.assertEqual(repairs.last_version("set the AC to 24, actually set the AC to 22"), "set the AC to 22")
        self.assertEqual(repairs.last_version("turn on tusker L1, I mean tusker L2"), "tusker L2")

    def test_a_bare_value_is_left_to_the_model(self):
        self.assertIsNone(repairs.last_version("set the AC to 24 no wait 22"))
        self.assertTrue(repairs.has_marker("set the AC to 24 no wait 22"))

    def test_no_marker_no_repair(self):
        self.assertFalse(repairs.has_marker("turn on the lights"))
        self.assertIsNone(repairs.last_version("turn on the lights"))

    def test_never_mind_is_a_command(self):
        m = match_command("never mind", REGISTRY, **OPTS)
        self.assertEqual(m.intent, "NEVER_MIND")


if __name__ == "__main__":
    unittest.main()
