"""Addressing "the lights" gets one sentence back, not every light's name."""

import asyncio
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from safety.reply_guard import compose  # noqa: E402
from tests.test_local_agent import _agent  # noqa: E402

NAMES = ["tusker edge", "tusker L1", "tusker L2"]


def _run(utterance, args, fail=()):
    a = _agent()
    a._light_names_fn = lambda: NAMES
    a._utterance = utterance

    async def call_tool(name, call_args):
        a.calls.append((name, call_args))
        if call_args.get("target") in fail:
            return False, f"{call_args['target']} didn't respond."
        return True, f"{call_args.get('target')} is on at {call_args.get('brightness')}%."

    a._call_tool = call_tool
    results = asyncio.run(a._run_guarded("device_control", args, strict=False))
    return a, results


class AllLightsReplyTests(unittest.TestCase):
    def test_brightness_for_all_lights_is_one_sentence(self):
        a, results = _run("set the lights to 50 percent", {"action": "lights_set", "target": "lights", "brightness": 50})
        self.assertEqual(len(a.calls), 3)  # every light still gets the command
        self.assertEqual(len(results), 1)
        spoken = compose(results)
        self.assertEqual(spoken, "All lights are at 50%.")
        for n in NAMES:
            self.assertNotIn(n, spoken)

    def test_colour_and_level(self):
        _, results = _run("make the lights red at 40 percent", {"action": "lights_set", "target": "lights", "color": "red", "brightness": 40})
        self.assertEqual(compose(results), "All lights are red at 40%.")

    def test_only_the_failed_light_is_named(self):
        _, results = _run("set the lights to 50 percent", {"action": "lights_set", "target": "lights", "brightness": 50}, fail=("tusker L1",))
        spoken = compose(results)
        self.assertIn("except sky light front", spoken)  # a failed half is named
        self.assertNotIn("cove light", spoken)
        self.assertTrue(results[0].ok)

    def test_when_nothing_responds_it_says_so_once(self):
        _, results = _run("set the lights to 50 percent", {"action": "lights_set", "target": "lights", "brightness": 50}, fail=tuple(NAMES))
        self.assertFalse(results[0].ok)
        self.assertEqual(len(results), 1)

    def test_one_named_light_is_unchanged(self):
        _, results = _run("set tusker edge to 50 percent", {"action": "lights_set", "target": "tusker edge", "brightness": 50})
        self.assertEqual(len(results), 1)
        self.assertIn("cove light", compose(results))


if __name__ == "__main__":
    unittest.main()


class BrightnessOfAllTests(unittest.TestCase):
    """2026-10-06 log: 'Set brightness of all lights to 80 percent' -> "couldn't find ... device matching 'brightness of all'".
    The command list's device slots now take only names the room knows, so words like "brightness of all" can
    never become a device name; those sentences go to the planner (tests/test_planner.py)."""

    def setUp(self):
        import settings
        from nlu.command_matcher import load_registry

        self.registry = load_registry(settings.COMMANDS_PATH)

    def test_wording_around_all_lights_is_never_taken_for_a_device_name(self):
        from nlu.command_matcher import match_command, resolve

        for text in ("Set brightness of all lights to 80 percent", "set the brightness of all the lights to 80",
                     "make every light 80 percent", "put all the lights at 80"):
            with self.subTest(text=text):
                m = match_command(text, self.registry)
                if m is not None:  # a match is fine only if it names no device at all
                    targets = [str(v).lower() for v in resolve(m).args.values()]
                    self.assertFalse(any("brightness" in t or t in ("all", "every") for t in targets), targets)

    def test_a_known_light_still_takes_the_fast_path(self):
        from nlu.command_matcher import match_command, resolve

        res = resolve(match_command("set brightness of tusker edge to 80 percent", self.registry))
        self.assertEqual((res.args["target"], res.args["brightness"]), ("tusker edge", 80))
        res = resolve(match_command("set the brightness of tusker L1 to 40", self.registry))
        self.assertEqual((res.args["target"], res.args["brightness"]), ("tusker L1", 40))
