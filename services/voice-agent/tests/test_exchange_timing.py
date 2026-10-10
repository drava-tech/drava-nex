"""logs/exchanges.jsonl: speech_end_to_first_text_ms and speech_end_to_first_audio_ms (agent/commands.py _log_exchange)."""

import asyncio
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from tests.test_local_agent import _agent  # noqa: E402


class _Log:
    def __init__(self):
        self.rows = []

    def write(self, record):
        self.rows.append(record)


class ExchangeTimingTests(unittest.TestCase):
    def test_without_a_voice_the_line_is_written_at_once_with_no_audio_time(self):
        a = _agent("x")
        a._xlog = _Log()
        a._log_exchange({"path": "knowledge"}, 10.0, {})
        self.assertEqual(a._xlog.rows, [{"path": "knowledge", "speech_end_to_first_audio_ms": None}])

    def test_with_a_voice_the_line_waits_for_the_first_audio_and_gives_both_times(self):
        a = _agent("x")
        a._xlog = _Log()
        a.elevenlabs = object()
        a._first_say = 10.5
        timing = {}

        async def go():
            a._log_exchange({"speech_end_to_first_text_ms": 500.0}, 10.0, timing)
            await asyncio.sleep(0.1)
            self.assertEqual(a._xlog.rows, [])  # no audio yet
            timing["first_audio_chunk_received"] = 10.9
            await asyncio.sleep(0.2)

        asyncio.run(go())
        row = a._xlog.rows[0]
        self.assertEqual(row["speech_end_to_first_text_ms"], 500.0)
        self.assertAlmostEqual(row["speech_end_to_first_audio_ms"], 900.0, places=3)

    def test_audio_that_never_starts_is_logged_without_a_time_after_the_wait(self):
        a = _agent("x")
        a._xlog = _Log()
        a.elevenlabs = object()
        a._first_say = 10.5
        a._AUDIO_WAIT_SEC = 0.1

        async def go():
            a._log_exchange({"path": "knowledge"}, 10.0, {})
            await asyncio.sleep(0.4)

        asyncio.run(go())
        self.assertIsNone(a._xlog.rows[0]["speech_end_to_first_audio_ms"])


if __name__ == "__main__":
    unittest.main()
