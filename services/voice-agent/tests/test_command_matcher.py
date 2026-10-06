import sys
import unittest
from datetime import datetime
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.command_matcher import (  # noqa: E402
    build_registry,
    expand_phrase,
    load_registry,
    match_command,
    normalize,
    resolve,
)

REGISTRY = load_registry(AGENT_ROOT / "config" / "commands.json")


def heard(text: str) -> tuple[str, str | None, dict]:
    """(intent, tool, args) for a spoken command, or ("LLM", None, {})."""
    m = match_command(text, REGISTRY)
    if m is None:
        return ("LLM", None, {})
    r = resolve(m, now=datetime(2026, 9, 30, 10, 0))
    return (m.intent, r.tool, r.args)


class PhraseSyntaxTests(unittest.TestCase):
    def test_alternatives_and_optionals_expand(self):
        self.assertEqual(
            expand_phrase("(turn|switch) on [the] {light}"),
            [
                ["turn", "on", "the", "{light}"],
                ["turn", "on", "{light}"],
                ["switch", "on", "the", "{light}"],
                ["switch", "on", "{light}"],
            ],
        )

    def test_numbers_become_digits_and_fillers_drop(self):
        self.assertEqual(normalize("Travis, please set the AC to twenty two"), "set ac 22")
        self.assertEqual(normalize("a hundred percent"), "100 percent")

    def test_a_command_needs_a_tool_or_reply(self):
        with self.assertRaises(ValueError):
            build_registry({"slots": {}, "commands": [{"intent": "X", "phrases": ["x"]}]})


class FastPathTests(unittest.TestCase):
    """Real phrasings from services/voice-control's variants test, mapped to
    this agent's tools. "LLM" = not a fast-path command."""

    CASES = [
        ("turn on edge light", ("LIGHT_ON", "device_control", {"action": "lights_on", "target": "tusker edge"})),
        ("Travis, turn on the edge.", ("LIGHT_ON", "device_control", {"action": "lights_on", "target": "tusker edge"})),
        ("edge off", ("LIGHT_OFF", "device_control", {"action": "lights_off", "target": "tusker edge"})),
        ("turn on L-1", ("LIGHT_ON", "device_control", {"action": "lights_on", "target": "tusker L1"})),
        ("turn on el one", ("LIGHT_ON", "device_control", {"action": "lights_on", "target": "tusker L1"})),
        ("turn off l3", ("LIGHT_OFF", "device_control", {"action": "lights_off", "target": "tusker L3"})),
        ("turn on the stretch fabric", ("LIGHT_ON", "device_control", {"action": "lights_on", "target": "tusker L3"})),
        ("lights on", ("ALL_LIGHTS_ON", "device_control", {"action": "all_lights_on"})),
        ("turn off all the lights", ("ALL_LIGHTS_OFF", "device_control", {"action": "all_lights_off"})),
        ("set edge to 50 percent", ("LIGHT_BRIGHTNESS", "device_control", {"action": "lights_set", "target": "tusker edge", "brightness": 50})),
        ("make edge red", ("LIGHT_COLOR", "device_control", {"action": "lights_set", "target": "tusker edge", "color": "red"})),
        ("L2 pink", ("LIGHT_COLOR", "device_control", {"action": "lights_set", "target": "tusker L2", "color": "magenta"})),
        ("tusker edge", ("LIGHT_NO_ACTION", None, {})),
        ("turn on the AC", ("AC_ON", "device_control", {"action": "ac_command", "target": "ac", "command": "power_on"})),
        ("off ac", ("AC_OFF", "device_control", {"action": "ac_command", "target": "ac", "command": "power_off"})),
        ("set AC to twenty four", ("AC_SET_TEMPERATURE", "device_control", {"action": "ac_command", "target": "ac", "command": "set_temp", "params": {"temp": 24}})),
        ("24 degrees on the ac", ("AC_SET_TEMPERATURE", "device_control", {"action": "ac_command", "target": "ac", "command": "set_temp", "params": {"temp": 24}})),
        ("set ac to cool mode", ("AC_SET_MODE", "device_control", {"action": "ac_command", "target": "ac", "command": "set_mode", "params": {"mode": "cool"}})),
        ("open the door", ("DOOR_UNLOCK", "device_control", {"action": "unlock"})),
        ("let me in", ("DOOR_UNLOCK", "device_control", {"action": "unlock"})),
        ("lock the door", ("DOOR_LOCK", "device_control", {"action": "lock"})),
        ("volume up", ("VOLUME_UP", "device_control", {"action": "ac_command", "command": "Volume Up", "params": {"times": 3}})),
        ("volume down by two", ("VOLUME_DOWN", "device_control", {"action": "ac_command", "command": "Volume Down", "params": {"times": 2}})),
        ("turn it down", ("VOLUME_DOWN", "device_control", {"action": "ac_command", "command": "Volume Down", "params": {"times": 3}})),
        ("mute", ("MUTE", "device_control", {"action": "ac_command", "command": "mute"})),
        ("pause tusker 86", ("SCREEN_PAUSE", "screen_control", {"action": "pause", "screen": "tusker 86"})),
        ("stop the tv", ("SCREEN_STOP", "screen_control", {"action": "stop", "screen": "tusker 86"})),
        ("stop", ("SCREEN_STOP", "screen_control", {"action": "stop"})),
        ("play tusker 27", ("SCREEN_PLAY", "screen_control", {"action": "play", "screen": "tusker 27"})),
        ("reset the view", ("RESET_VIEW", "screen_control", {"action": "reset_view"})),
        ("show video intro reel on tusker 86", ("MEDIA_SELECT", "screen_control", {"action": "assign_media", "content": "intro reel", "screen": "tusker 86"})),
        ("pre entry mode", ("AMBIENT_MODE", "device_control", {"action": "ambient_mode", "target": "pre-entry"})),
        ("hi", ("SCENE_WELCOME", "device_control", {"action": "good_morning"})),
        ("bye", ("SCENE_GOODBYE", "device_control", {"action": "good_night"})),
        ("shut down", ("SHUTDOWN", "shutdown_travis", {})),
        # Not fast-path commands: the LLM handles these.
        ("switch off 1", ("LLM", None, {})),
        ("increase the temperature", ("LLM", None, {})),
        ("play welcome screen on tusker 86", ("CONTENT_ON_SCREEN", "screen_control", {"action": "assign_content", "content": "welcome screen", "screen": "tusker 86"})),
        ("turn off the lights and set the ac to 22", ("LLM", None, {})),
        ("what's the weather like", ("LLM", None, {})),
    ]

    def test_cases(self):
        for text, expected in self.CASES:
            with self.subTest(text=text):
                self.assertEqual(heard(text), expected)

    def test_door_is_never_fuzzy(self):
        self.assertEqual(heard("unlok the door")[0], "LLM")

    def test_near_miss_is_corrected(self):
        self.assertEqual(
            heard("set edge brightnes to 50"),
            ("LIGHT_BRIGHTNESS", "device_control", {"action": "lights_set", "target": "tusker edge", "brightness": 50}),
        )

    def test_a_near_tie_goes_to_the_llm(self):
        # "lights of" is as close to "lights on" as to "lights off".
        self.assertEqual(heard("lights of")[0], "LLM")

    def test_stop_travis_is_the_screen_not_shutdown(self):
        # "travis" is a filler word, so "stop travis" is just "stop".
        self.assertEqual(heard("stop travis")[0], "SCREEN_STOP")

    def test_success_confirmation_uses_the_spoken_value(self):
        m = match_command("set the ac to 22", REGISTRY)
        assert m is not None
        self.assertEqual(resolve(m).text, "AC set to 22 degrees.")

    def test_time_greeting(self):
        m = match_command("good evening", REGISTRY)
        assert m is not None
        self.assertEqual(resolve(m, now=datetime(2026, 9, 30, 20, 0)).text, "Good evening! How can I help?")


if __name__ == "__main__":
    unittest.main()
