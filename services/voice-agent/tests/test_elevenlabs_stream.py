import unittest
import asyncio
from unittest.mock import AsyncMock, patch
from websockets.protocol import State
from speech.elevenlabs_stream import ElevenLabsStreamer, _is_open
from settings import load_api_config


class _FakeWebSocket:
    """Minimal stand-in for a websockets ClientConnection: supports the
    handshake send() in ensure_session() and being iterated by
    _receive_loop() without hanging (yields nothing, ends immediately)."""

    def __init__(self):
        self.state = State.OPEN
        self.sent = []

    async def send(self, payload):
        self.sent.append(payload)

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration

    async def close(self):
        self.state = State.CLOSED


class ElevenLabsStreamerTests(unittest.TestCase):
    def test_availability_flags(self):
        s_empty = ElevenLabsStreamer("", "")
        self.assertFalse(s_empty.is_available)

        s_valid = ElevenLabsStreamer("test_key", "test_voice")
        self.assertTrue(s_valid.is_available)
        self.assertEqual(s_valid.model_id, "eleven_flash_v2_5")

    def test_cancel_cleans_up_cleanly(self):
        async def run_cancel():
            q = asyncio.Queue()
            s = ElevenLabsStreamer("key", "voice", audio_queue=q)
            await s.cancel()
            self.assertFalse(s._is_connected)
            self.assertIsNone(s._ws)

        asyncio.run(run_cancel())

    def test_prewarm_opens_session_without_sending_text(self):
        async def run_prewarm():
            fake_ws = _FakeWebSocket()
            with patch(
                "speech.elevenlabs_stream.websockets.connect",
                AsyncMock(return_value=fake_ws),
            ):
                s = ElevenLabsStreamer("key", "voice", audio_queue=asyncio.Queue())
                ok = await s.prewarm()
                self.assertTrue(ok)
                self.assertTrue(_is_open(s._ws))
                # Only the handshake was sent — prewarm() must not synthesize
                # any text.
                self.assertEqual(len(fake_ws.sent), 1)
                # Calling it again while already open must not reconnect.
                ok_again = await s.prewarm()
                self.assertTrue(ok_again)
                self.assertEqual(len(fake_ws.sent), 1)
                await asyncio.sleep(0)  # let the recv task drain and exit
                await s.cancel()

        asyncio.run(run_prewarm())

    def test_load_api_config_includes_elevenlabs(self):
        cfg = load_api_config()
        self.assertIn("elevenlabs_api_key", cfg)
        self.assertIn("elevenlabs_voice_id", cfg)
        self.assertEqual(cfg.get("elevenlabs_model_id"), "eleven_flash_v2_5")


if __name__ == "__main__":
    unittest.main()
