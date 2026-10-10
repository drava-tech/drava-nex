"""ActionGuard: nothing is sent unless it was said; ambiguity becomes a question."""

import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from safety.action_guard import ActionGuard  # noqa: E402
from nlu.command_matcher import load_registry  # noqa: E402

REGISTRY = load_registry(AGENT_ROOT / "config" / "commands.json")
LIGHTS = lambda: ["tusker edge", "tusker L1", "tusker L2"]  # noqa: E731


def prep(utterance, name, args, strict=True, guard=None):
    return (guard or ActionGuard(REGISTRY)).prepare(name, args, utterance, LIGHTS, strict)


def dev(**a):
    return a


class GuessingBecomesAQuestion(unittest.TestCase):
    def asks(self, utterance, args, name="device_control", **kw):
        p = prep(utterance, name, args, **kw)
        self.assertIsNotNone(p.question, f"expected a question, got calls {p.calls}")
        self.assertEqual(p.calls, [])
        return p.question

    def test_a_placeholder_is_never_a_device(self):
        for target in ("the room", "it", "that", "them", "something", "here"):
            with self.subTest(target=target):
                self.asks("make it brighter", dev(action="lights_set", target=target, brightness=60))

    def test_an_invented_device_is_refused(self):
        # a named device that was never said, and no light words at all
        q = self.asks("it is a bit gloomy in here", dev(action="lights_on", target="tusker L1"))
        self.assertIn("cove light", q)  # the question offers the room's names
        self.assertIn("sky light", q)
        self.assertNotIn("front", q)  # the sky light is one choice
        # a device that was never said, even though "lights" was
        self.asks("make the lights a bit brighter please", dev(action="lights_on", target="tusker L1"))

    def test_a_level_nobody_said_is_not_sent(self):
        q = self.asks("make tusker edge a bit brighter", dev(action="lights_set", target="tusker edge", brightness=60))
        self.assertIn("0 to 100", q)

    def test_a_temperature_nobody_said_is_not_sent(self):
        q = self.asks("set temperature to banana", dev(action="ac_command", command="set_temp", params={"temp": 22}))
        self.assertIn("16 to 30", q)

    def test_out_of_range_values_are_refused_not_clamped(self):
        for temp in (5, 15, 31, 200):
            with self.subTest(temp=temp):
                q = self.asks(f"set the AC to {temp} degrees", dev(action="ac_command", command="set_temp", params={"temp": temp}))
                self.assertIn("16 to 30", q)
        q = self.asks("set tusker edge to 150 percent", dev(action="lights_set", target="tusker edge", brightness=150))
        self.assertIn("0 to 100", q)
        q = self.asks("turn the volume up by fifty", dev(action="ac_command", command="Volume Up", params={"times": 50}))
        self.assertIn("1 to 10", q)

    def test_boundaries_are_allowed(self):
        for temp in (16, 30):
            self.assertIsNone(prep(f"set the AC to {temp}", "device_control", dev(action="ac_command", command="set_temp", params={"temp": temp})).question)
        self.assertIsNone(prep("set tusker edge to 0 percent", "device_control", dev(action="lights_set", target="tusker edge", brightness=0)).question)
        self.assertIsNone(prep("set tusker edge to 100 percent", "device_control", dev(action="lights_set", target="tusker edge", brightness=100)).question)

    def test_unknown_mode_and_fan_speed_ask(self):
        self.asks("set the AC to turbo mode", dev(action="ac_command", command="set_mode", params={"mode": "turbo"}))
        self.asks("set the AC fan to hurricane", dev(action="ac_command", command="set_fan", params={"fan": "hurricane"}))
        self.asks("set the AC to something", dev(action="ac_command", command="set_mode", params={"mode": "cool"}))  # cool wasn't said

    def test_scene_actions_need_their_cue_words(self):
        for action in ("good_night", "good_morning", "lock", "unlock", "all_lights_off"):
            with self.subTest(action=action):
                self.asks("switch it off", dev(action=action))
        self.assertIsNone(prep("shut everything down", "device_control", dev(action="good_night")).question)
        self.assertIsNone(prep("secure the door", "device_control", dev(action="lock")).question)

    def test_the_model_cannot_swap_the_ac_for_a_light(self):
        self.asks("switch the air conditioner on", dev(action="lights_on", target="tusker L1"))

    def test_a_mode_must_be_said(self):
        self.asks("set the mood", dev(action="ambient_mode", target="meeting"))
        self.assertIsNone(prep("put the room in meeting mode", "device_control", dev(action="ambient_mode", target="meeting")).question)

    def test_content_and_screen_must_be_said(self):
        self.asks("show something on a screen", dict(action="assign_media", screen="tusker 86", content="Company Presentation"), name="screen_control")
        q = self.asks("show the company presentation", dict(action="assign_media", content="Company Presentation"), name="screen_control")
        # No screen at all: not "which screen?" (the answer would arrive without the title) but the whole command again.
        self.assertIn("repeat the whole command", q)
        self.assertIsNone(prep("show the company presentation on tusker 86", "screen_control",
                               dict(action="assign_media", screen="tusker 86", content="company presentation")).question)

    def test_the_unit_has_to_fit_the_thing(self):
        self.asks("set tusker edge to 24 degrees", dev(action="lights_set", target="tusker edge", brightness=24))
        self.asks("set the AC to 50 percent", dev(action="ac_command", command="set_temp", params={"temp": 50}))
        self.assertIsNone(prep("set the AC to 24 degrees", "device_control", dev(action="ac_command", command="set_temp", params={"temp": 24})).question)

    def test_a_light_action_cannot_target_the_ac(self):
        self.asks("increase the brightness to 80", dev(action="lights_set", target="AC", brightness=80))
        self.asks("make the AC brighter please", dev(action="lights_on", target="Experience Center AC"))

    def test_presentation_mode_needs_the_word_mode(self):
        self.asks("show the presentation", dev(action="ambient_mode", target="presentation"))
        self.assertIsNone(prep("presentation mode", "device_control", dev(action="ambient_mode", target="presentation")).question)


class WhatIsAllowed(unittest.TestCase):
    def test_a_said_name_passes_even_by_its_short_alias(self):
        p = prep("turn on l 3 please", "device_control", dev(action="lights_on", target="tusker L3"))
        self.assertIsNone(p.question)
        self.assertEqual(p.calls[0][1]["target"], "tusker L3")

    def test_the_ac_target_is_forced_whatever_the_model_called_it(self):
        p = prep("set the AC to 22", "device_control", dev(action="ac_command", target="tusker ac", command="set_temp", params={"temp": 22.0}))
        self.assertEqual(p.calls[0][1]["target"], "ac")
        self.assertEqual(p.calls[0][1]["params"]["temp"], 22)

    def test_the_lights_means_all_of_them(self):
        p = prep("turn off the lights", "device_control", dev(action="lights_off", target="the lights"))
        self.assertEqual(p.calls, [("device_control", {"action": "all_lights_off"})])
        p = prep("turn the lights to 70 percent", "device_control", dev(action="lights_set", target="lights", brightness=70))
        self.assertEqual([c[1]["target"] for c in p.calls], ["tusker edge", "tusker L1", "tusker L2"])
        self.assertTrue(all(c[1]["brightness"] == 70 for c in p.calls))
        # no name at all, but "lights" was said
        p = prep("set the lights to 70 percent", "device_control", dev(action="lights_set", brightness=70))
        self.assertEqual(len(p.calls), 3)

    def test_a_colour_nobody_asked_for_is_dropped_not_sent(self):
        p = prep("make tusker edge 40 percent", "device_control", dev(action="lights_set", target="tusker edge", brightness=40, color="warm white"))
        self.assertNotIn("color", p.calls[0][1])
        p = prep("make tusker edge blue", "device_control", dev(action="lights_set", target="tusker edge", color="blue", brightness=100))
        self.assertNotIn("brightness", p.calls[0][1])

    def test_matcher_built_calls_are_not_grounded_but_are_checked(self):
        p = prep("l 3 on", "device_control", dev(action="lights_on", target="tusker L3"), strict=False)
        self.assertIsNone(p.question)
        p = prep("whatever", "device_control", dev(action="ac_command", command="set_temp", params={"temp": 99}), strict=False)
        self.assertIsNotNone(p.question)

    def test_screen_calls_without_a_screen_ask_with_the_real_names(self):
        p = prep("pause", "screen_control", dict(action="pause"), strict=False)
        self.assertIn("tusker 86 or tusker 27", p.question)


class WhatItMeans(unittest.TestCase):
    def test_it_refers_to_the_thing_just_used(self):
        g = ActionGuard(REGISTRY)
        g.remember("device_control", dev(action="lights_on", target="tusker edge"), True)
        p = prep("make it 80 percent", "device_control", dev(action="lights_set", target="it", brightness=80), guard=g)
        self.assertEqual(p.calls[0][1]["target"], "tusker edge")
        p = prep("turn it off", "device_control", dev(action="lights_off"), guard=g)
        self.assertEqual(p.calls[0][1]["target"], "tusker edge")

    def test_it_after_the_ac_means_the_ac(self):
        g = ActionGuard(REGISTRY)
        g.remember("device_control", dev(action="ac_command", command="set_temp", params={"temp": 24}), True)
        self.assertIsNone(prep("make it 22", "device_control", dev(action="ac_command", command="set_temp", params={"temp": 22}), guard=g).question)
        self.assertIsNone(prep("turn it off", "device_control", dev(action="ac_command", command="power_off"), guard=g).question)

    def test_it_with_nothing_before_it_asks(self):
        self.assertIsNotNone(prep("turn it off", "device_control", dev(action="ac_command", command="power_off")).question)
        self.assertIsNotNone(prep("turn it off", "device_control", dev(action="lights_off", target="it")).question)

    def test_a_failed_action_is_not_remembered(self):
        g = ActionGuard(REGISTRY)
        g.remember("device_control", dev(action="lights_on", target="tusker edge"), False)
        self.assertIsNotNone(prep("turn it off", "device_control", dev(action="lights_off", target="tusker edge"), guard=g).question)

    def test_it_goes_stale(self):
        g = ActionGuard(REGISTRY, ttl=120)
        g.remember("device_control", dev(action="lights_on", target="tusker edge"), True)
        g.age(900)
        self.assertEqual(g.context_line(), "")
        self.assertIsNotNone(prep("turn it off", "device_control", dev(action="lights_off", target="tusker edge"), guard=g).question)

    def test_them_after_all_lights(self):
        g = ActionGuard(REGISTRY)
        g.remember("device_control", dev(action="all_lights_on"), True)
        p = prep("make them 80 percent", "device_control", dev(action="lights_set", target="the lights", brightness=80), guard=g)
        self.assertEqual(len(p.calls), 3)

    def test_the_context_line_tells_the_model_what_was_last_used(self):
        g = ActionGuard(REGISTRY)
        g.remember("device_control", dev(action="lights_on", target="tusker edge"), True)
        g.remember("screen_control", dict(action="stop", screen="tusker 86"), True)
        line = g.context_line()
        self.assertIn("tusker edge", line)
        self.assertIn("tusker 86", line)


class OneLightAsksWhich(unittest.TestCase):
    """'off the light' is one light, so ask which; 'the lights' / 'all lights' / 'light up the room' are all."""

    def test_singular_light_asks_which(self):
        for utterance, action in (
            ("off the light", "all_lights_off"),
            ("turn off the light", "all_lights_off"),
            ("on the light", "all_lights_on"),
            ("turn on the light", "all_lights_on"),
        ):
            for strict in (True, False):
                with self.subTest(utterance=utterance, strict=strict):
                    p = prep(utterance, "device_control", dev(action=action), strict=strict)
                    self.assertEqual(p.calls, [])
                    self.assertIn("Which light", p.question)
                    self.assertIn("sky light", p.question)
                    self.assertNotIn("front", p.question)

    def test_model_call_on_a_singular_light_asks_which(self):
        p = prep("turn off the light", "device_control", dev(action="lights_off", target="the light"))
        self.assertEqual(p.calls, [])
        self.assertIn("Which light", p.question)

    def test_plural_and_all_still_switch_everything(self):
        for utterance, action in (
            ("off the lights", "all_lights_off"),
            ("turn off the lights", "all_lights_off"),
            ("turn on all the lights", "all_lights_on"),
            ("turn on every light", "all_lights_on"),
            ("light up the room", "all_lights_on"),
        ):
            with self.subTest(utterance=utterance):
                p = prep(utterance, "device_control", dev(action=action), strict=False)
                self.assertIsNone(p.question)
                self.assertEqual(p.calls, [("device_control", {"action": action})])

    def test_a_named_light_is_unaffected(self):
        p = prep("turn off the tusker L1 light", "device_control", dev(action="lights_off", target="tusker L1"))
        self.assertIsNone(p.question)


if __name__ == "__main__":
    unittest.main()
