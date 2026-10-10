"""nlu/transcript_fixes.py: the company name, misheard, is repaired as a whole phrase and never inside a device command."""

import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.transcript_fixes import fix_company_name  # noqa: E402
from tests.test_local_agent import REGISTRY  # noqa: E402

DEVICES = [k for slot in ("light", "screenAlias") for k in (REGISTRY.slots.get(slot) or {}).get("values", {})]


class FixTests(unittest.TestCase):
    def test_logged_and_expected_mishearings_are_repaired(self):
        cases = {
            "What is the whitest cove": "What is the White Tusker",
            "Tell me about White Dusk Door": "Tell me about White Tusker",
            "Tell me about white tissue": "Tell me about White Tusker",
            "Tell me about the white vest": "Tell me about the White Tusker",
            "What is white usker?": "What is White Tusker?",
            "who founded white tasker": "who founded White Tusker",
            "tell me about white tusk": "tell me about White Tusker",
            "what does white husker do": "what does White Tusker do",
        }
        for heard, fixed in cases.items():
            with self.subTest(heard=heard):
                self.assertEqual(fix_company_name(heard, DEVICES), fixed)

    def test_only_the_whole_phrase(self):
        for t in ("whitest coverage", "a white vestibule", "the white tuskers of africa", "somewhitest cove", "white tusker"):
            with self.subTest(t=t):
                self.assertEqual(fix_company_name(t, DEVICES), t)

    def test_never_inside_a_device_command(self):
        for t in ("turn on the white vest", "set the whitest cove to 50 percent", "show white tissue on tusker 86", "play white tusk", "turn off cove light white tissue",
                  "tusker edge white vest"):
            with self.subTest(t=t):
                self.assertEqual(fix_company_name(t, DEVICES), t)

    def test_already_right_or_empty_is_unchanged(self):
        self.assertEqual(fix_company_name("Tell me about White Tusker", DEVICES), "Tell me about White Tusker")
        self.assertEqual(fix_company_name("", DEVICES), "")


if __name__ == "__main__":
    unittest.main()
