"""The room's names: cove light, sky light (front and back are one unless asked), main tv, kiosk."""

import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.command_matcher import match_command, resolve  # noqa: E402
from nlu.spoken_names import say_names  # noqa: E402
from tests.test_local_agent import REGISTRY  # noqa: E402


def target(text):
    m = match_command(text, REGISTRY)
    return None if m is None else resolve(m).args.get("target")


class AliasTests(unittest.TestCase):
    def test_each_name_reaches_the_right_light(self):
        for text, want in (
            ("turn on the cove light", "tusker edge"), ("turn off cove lights", "tusker edge"),
            ("turn on sky light front", "tusker L1"), ("turn off the sky light back", "tusker L2"),
            ("turn on the sky light", "tusker L3"), ("turn off sky lights", "tusker L3"),
        ):
            with self.subTest(text=text):
                self.assertEqual(target(text), want)

    def test_screens(self):
        for text, want in (("play main tv", "tusker 86"), ("pause the kiosk", "tusker 27"), ("stop main screen", "tusker 86")):
            with self.subTest(text=text):
                m = match_command(text, REGISTRY)
                self.assertIsNotNone(m)
                self.assertEqual(resolve(m).args.get("screen"), want)


class SpokenTests(unittest.TestCase):
    def test_technical_names_become_the_rooms_names(self):
        self.assertEqual(say_names("tusker edge is on at 50%."), "cove light is on at 50%.")
        self.assertEqual(say_names("Tusker L3 is off."), "sky light is off.")
        self.assertEqual(say_names("tusker L1 and tusker L2"), "sky light front and sky light back")
        self.assertEqual(say_names("tusker 86 is playing"), "tusker 86 is playing")  # screens keep their names
        self.assertEqual(say_names("tusker L30"), "tusker L30")

    def test_the_company_is_white_tusker_never_the_white_tusker(self):
        self.assertEqual(say_names("The White Tusker is a studio."), "White Tusker is a studio.")
        self.assertEqual(say_names("Ask about the white tusker, or THE WHITE TUSKER's films."), "Ask about White Tusker, or White Tusker's films.")
        self.assertEqual(say_names("Say hello to White Tusker."), "Say hello to White Tusker.")
        self.assertEqual(say_names("You can reach us at hello at thewhitetusker dot com."), "You can reach us at hello at thewhitetusker dot com.")
        self.assertEqual(say_names("Gather white tusker"), "Gather white tusker")  # only a leading "the" goes

    def test_it_is_idempotent(self):
        once = say_names("tusker edge and tusker L3")
        self.assertEqual(say_names(once), once)


if __name__ == "__main__":
    unittest.main()
