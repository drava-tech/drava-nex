import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from actions import list_inventory as li  # noqa: E402


class InventoryTests(unittest.TestCase):
    def listed(self, names):
        with mock.patch.object(li.cms_client, "list_devices", return_value=[{"name": n} for n in names]):
            return li.list_inventory({"kind": "devices"})

    def test_l3_is_listed_as_a_group_and_the_soundbar_is_hidden(self):
        out = self.listed(["tusker L2", "tusker L1", "tusker edge", "Experience Centre AC", "Soundbar", "TV"])
        # The room's names; the front and back sky lights are one "sky light", never listed separately.
        self.assertIn("sky light", out)
        self.assertIn("cove light", out)
        for hidden in ("front", "back", "tusker", "L1", "L2"):
            self.assertNotIn(hidden, out)
        self.assertNotIn("Soundbar", out)
        self.assertIn("I can control the cove light,", out)
        self.assertIn("and the sky light", out)

    def test_no_group_without_both_members(self):
        self.assertNotIn("L3", self.listed(["tusker L1", "TV"]))


if __name__ == "__main__":
    unittest.main()


class ListKindTests(unittest.TestCase):
    """2026-10-07: "List all the lights you can control" answered with every device (AC and TV too)."""

    DEVICES = [
        {"name": "tusker L2", "type": "light"}, {"name": "tusker L1", "type": "light"},
        {"name": "tusker edge", "type": "light"}, {"name": "Experience Centre AC", "type": "ac"},
        {"name": "TV", "type": "tv"}, {"name": "Soundbar", "type": "audio"},
    ]

    def test_lights_only(self):
        with mock.patch.object(li.cms_client, "list_devices", return_value=self.DEVICES):
            out = li.list_inventory({"kind": "lights"})
        self.assertEqual(out, "I can control two lights: the cove light and the sky light.")
        for other in ("AC", "TV", "Soundbar", "front", "back"):
            self.assertNotIn(other, out)

    def test_asking_for_lights_by_voice_never_reaches_the_model(self):
        import settings
        from nlu.command_matcher import load_registry, match_command, resolve

        m = match_command("List all the lights you can control", load_registry(settings.COMMANDS_PATH))
        self.assertEqual((m.intent, resolve(m).args), ("LIST_LIGHTS", {"kind": "lights"}))
