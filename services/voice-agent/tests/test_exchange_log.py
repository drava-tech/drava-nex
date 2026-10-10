import json
import sys
import tempfile
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from agent.exchange_log import ExchangeLog, format_row, read  # noqa: E402
from tests.test_local_agent import _agent, _hear, _with_messages  # noqa: E402


class ExchangeLogTests(unittest.TestCase):
    def test_round_trip_and_last_n(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sub" / "x.jsonl"
            log = ExchangeLog(path)
            for i in range(5):
                log.write({"command": f"c{i}"})
            self.assertEqual([r["command"] for r in read(path, 2)], ["c3", "c4"])

    def test_a_logging_failure_never_raises(self):
        ExchangeLog(Path("/nonexistent-drive-zz:/x/y.jsonl")).write({"a": 1})  # must not raise
        self.assertEqual(read(Path("/nope.jsonl")), [])

    def test_a_command_is_logged_with_its_calls_and_reply(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "x.jsonl"
            a = _agent("Hey Travis set the AC to 24 and turn on tusker edge")
            a._xlog = ExchangeLog(path)
            _with_messages(a, {"lights_on": "tusker edge is on."})
            _hear(a)
            (row,) = read(path)
            self.assertEqual(row["path"], "list (several actions)")
            self.assertEqual([c["args"]["action"] for c in row["calls"]], ["ac_command", "lights_on"])
            self.assertEqual(row["reply"], "AC set to 24 degrees. cove light is on.")
            self.assertEqual(row["heard"]["language"], "en")
            self.assertIn("set the AC to 24", row["command"])

    def test_a_held_back_call_is_logged_as_not_sent(self):
        from nlu.local_llm import ToolCall
        from tests.test_local_agent import _FakeLLM

        bad = ("tool_calls", [ToolCall("device_control", {"action": "ac_command", "command": "set_temp", "params": {"temp": 5}})])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "x.jsonl"
            a = _agent("Hey Travis set the AC to 5 degrees", _llm=_FakeLLM([bad], [("text", "")]))
            a._xlog = ExchangeLog(path)
            _with_messages(a, {})
            _hear(a)
            (row,) = read(path)
            (call,) = row["calls"]
            self.assertTrue(call["rejected"])
            self.assertFalse(call["ok"])
            self.assertIn("16 to 30", call["message"])
            self.assertEqual(a.calls, [])  # and nothing reached the CMS
            self.assertIn("NOT SENT", format_row(row))

    def test_ignored_speech_is_logged_with_the_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "x.jsonl"
            a = _agent("turn on the lights")  # no wake word in what Whisper heard
            a._xlog = ExchangeLog(path)
            _hear(a)
            (row,) = read(path)
            self.assertIn("false wake", row["ignored"])
            self.assertIn("IGNORED", format_row(row))

    def test_format_row_is_readable(self):
        text = format_row({"t": "2026-10-05 10:00:00", "path": "model", "heard": {"text": "hey travis lock the door"}, "command": "lock the door",
                           "calls": [{"name": "device_control", "args": {"action": "lock"}, "ok": True}], "reply": "Door locked.",
                           "speech_end_to_first_word_ms": 812.0})
        self.assertIn("device_control:lock", text)
        self.assertIn("812 ms", text)
        json.dumps(text)


if __name__ == "__main__":
    unittest.main()
