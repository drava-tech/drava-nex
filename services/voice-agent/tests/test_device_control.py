import unittest
from unittest import mock

from actions import device_control as dc


class AmbientModeMemoryTests(unittest.TestCase):
    """A lighting mode is not a device, so it must never become the "it" a
    follow-up like "turn it off" refers to."""

    def setUp(self):
        dc._last_device_target = None

    def _run(self, params, result):
        with mock.patch.object(dc.cms_client, "device_command", return_value=result) as cmd:
            out = dc.device_control(params)
        return out, cmd

    def test_mode_is_sent_with_its_target_and_not_remembered(self):
        out, cmd = self._run(
            {"action": "ambient_mode", "target": "meeting mode"},
            {"message": "Meeting mode is on.", "resolvedTarget": "Meeting mode"},
        )
        self.assertEqual(out, "Meeting mode is on.")
        self.assertEqual(cmd.call_args.kwargs["target"], "meeting mode")
        self.assertIsNone(dc._last_device_target)

    def test_mode_without_a_name_never_borrows_the_last_device(self):
        dc._last_device_target = "tusker L1"
        _, cmd = self._run({"action": "ambient_mode"}, {"message": "Which mode did you mean?"})
        self.assertIsNone(cmd.call_args.kwargs["target"])

    def test_devices_are_still_remembered(self):
        self._run(
            {"action": "lights_on", "target": "tusker L1"},
            {"message": "on", "resolvedTarget": "tusker L1"},
        )
        self.assertEqual(dc._last_device_target, "tusker L1")


if __name__ == "__main__":
    unittest.main()
