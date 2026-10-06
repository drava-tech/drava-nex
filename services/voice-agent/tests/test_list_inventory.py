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
        self.assertIn("tusker L3, which is L1 and L2 together", out)
        self.assertNotIn("Soundbar", out)
        self.assertIn("6 controllable devices", out)

    def test_no_group_without_both_members(self):
        self.assertNotIn("L3", self.listed(["tusker L1", "TV"]))


if __name__ == "__main__":
    unittest.main()
