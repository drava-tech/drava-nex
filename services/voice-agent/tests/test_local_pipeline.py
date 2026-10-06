"""Unit tests for the local (no-Gemini) pipeline pieces: VAD endpointing,
the English-only language decision, the Ollama client, wake-word stripping."""

import asyncio
import json
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

import httpx  # noqa: E402

from nlu.local_llm import OllamaChat, ToolCall, tools_to_json_schema  # noqa: E402
from speech.stt import decide_language  # noqa: E402
from speech.transcript_gate import strip_wake_word  # noqa: E402
from speech.vad import FRAME_MS, Endpointer  # noqa: E402

RATE = 16000
FRAME_BYTES = RATE * FRAME_MS // 1000 * 2


class _FakeVad:
    """Speech = any non-zero sample in the frame."""

    def is_speech(self, frame: bytes, rate: int) -> bool:
        return any(frame)


def _frames(n: int, speech: bool) -> bytes:
    return (b"\x01\x00" if speech else b"\x00\x00") * (FRAME_BYTES // 2) * n


class EndpointerTests(unittest.TestCase):
    def _ep(self, **kw):
        return Endpointer(RATE, start_ms=60, end_ms=300, preroll_ms=90, vad=_FakeVad(), **kw)

    def test_utterance_ends_after_the_silence_window(self):
        ep = self._ep()
        self.assertEqual(ep.feed(_frames(20, True)), [])
        self.assertEqual(ep.feed(_frames(9, False)), [])  # 270ms: still talking
        (utt,) = ep.feed(_frames(1, False))  # 300ms of silence
        # 20 speech frames + at most ~200ms of trailing silence kept.
        self.assertGreaterEqual(len(utt), 20 * FRAME_BYTES)
        self.assertLessEqual(len(utt), 26 * FRAME_BYTES)

    def test_odd_chunk_sizes_are_reframed(self):
        ep = self._ep()
        audio = _frames(20, True) + _frames(10, False)
        out = []
        for i in range(0, len(audio), 1000):  # not a multiple of a frame
            out += ep.feed(audio[i : i + 1000])
        self.assertEqual(len(out), 1)

    def test_a_click_is_not_speech(self):
        ep = self._ep()
        self.assertEqual(ep.feed(_frames(1, True) + _frames(30, False)), [])
        self.assertFalse(ep.in_speech)

    def test_leading_silence_is_trimmed_to_the_preroll(self):
        ep = self._ep()
        (utt,) = ep.feed(_frames(50, False) + _frames(10, True) + _frames(10, False))
        # 3 pre-roll frames + 10 speech + up to 6 tail frames, never the 50.
        self.assertLessEqual(len(utt), 19 * FRAME_BYTES)

    def test_a_long_monologue_is_cut_at_the_cap(self):
        ep = self._ep(max_ms=900)
        self.assertEqual(len(ep.feed(_frames(40, True))), 1)

    def test_reset_drops_a_half_heard_utterance(self):
        ep = self._ep()
        ep.feed(_frames(10, True))
        ep.reset()
        self.assertEqual(ep.feed(_frames(10, False)), [])


class LanguageDecisionTests(unittest.TestCase):
    def test_english_is_transcribed(self):
        self.assertIsNone(decide_language([("en", 0.9), ("hi", 0.05)]))

    def test_confident_other_language_is_rejected(self):
        self.assertEqual(decide_language([("hi", 0.85), ("en", 0.05)]), "hi")

    def test_unsure_detection_falls_back_to_english(self):
        # Accented English guessed as Hindi with low confidence.
        self.assertIsNone(decide_language([("hi", 0.45), ("en", 0.35)]))

    def test_english_still_plausible_is_not_rejected(self):
        self.assertIsNone(decide_language([("hi", 0.6), ("en", 0.3)]))

    def test_no_probabilities_fails_open(self):
        self.assertIsNone(decide_language([]))


class StripWakeWordTests(unittest.TestCase):
    def test_leading_wake_word(self):
        self.assertEqual(strip_wake_word("Travis, turn on the lights."), "turn on the lights")

    def test_misheard_and_split_wake_word(self):
        self.assertEqual(strip_wake_word("Trevis lights off"), "lights off")
        self.assertEqual(strip_wake_word("Tra vis, lights off"), "lights off")
        self.assertEqual(strip_wake_word("Hey Travis, mute"), "mute")

    def test_trailing_wake_word(self):
        self.assertEqual(strip_wake_word("lock the door, Travis."), "lock the door")

    def test_only_the_wake_word(self):
        self.assertEqual(strip_wake_word("Travis."), "")

    def test_a_name_mid_sentence_stays(self):
        self.assertEqual(strip_wake_word("ask travis about it"), "ask travis about it")


def _ndjson(*chunks) -> bytes:
    return b"".join(json.dumps(c).encode() + b"\n" for c in chunks)


class OllamaChatTests(unittest.TestCase):
    def test_gemini_schema_is_converted(self):
        (tool,) = tools_to_json_schema(
            [
                {
                    "name": "device_control",
                    "description": "d",
                    "parameters": {
                        "type": "OBJECT",
                        "properties": {"params": {"type": "OBJECT", "properties": {"temp": {"type": "INTEGER"}}}},
                        "required": ["action"],
                    },
                },
            ]
        )
        fn = tool["function"]
        self.assertEqual(tool["type"], "function")
        self.assertEqual(fn["parameters"]["type"], "object")
        self.assertEqual(fn["parameters"]["properties"]["params"]["properties"]["temp"]["type"], "integer")
        self.assertEqual(fn["parameters"]["required"], ["action"])

    def test_tool_without_parameters_gets_an_empty_object(self):
        (tool,) = tools_to_json_schema([{"name": "shutdown_travis", "description": ""}])
        self.assertEqual(tool["function"]["parameters"], {"properties": {}, "type": "object"})

    def _run(self, body: bytes):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["payload"] = json.loads(request.content)
            return httpx.Response(200, content=body)

        chat = OllamaChat(transport=httpx.MockTransport(handler))

        async def collect():
            return [e async for e in chat.stream([{"role": "user", "content": "hi"}], [])]

        return asyncio.run(collect()), seen["payload"]

    def test_streams_text_with_thinking_disabled(self):
        events, payload = self._run(
            _ndjson(
                {"message": {"content": "All "}},
                {"message": {"content": "done."}},
                {"message": {"content": ""}, "done": True},
            )
        )
        self.assertEqual(events, [("text", "All "), ("text", "done.")])
        self.assertIs(payload["think"], False)
        self.assertEqual(payload["model"], "qwen3:8b")

    def test_tool_calls_come_last(self):
        events, _ = self._run(
            _ndjson(
                {"message": {"content": "", "tool_calls": [{"function": {"name": "device_control", "arguments": {"action": "lock"}}}]}},
                {"message": {"content": ""}, "done": True},
            )
        )
        self.assertEqual(events, [("tool_calls", [ToolCall("device_control", {"action": "lock"})])])

    def test_a_stray_think_block_is_never_spoken(self):
        events, _ = self._run(
            _ndjson(
                {"message": {"content": "<think>hmm"}},
                {"message": {"content": "still thinking"}},
                {"message": {"content": "</think>Okay."}},
                {"done": True, "message": {}},
            )
        )
        self.assertEqual(events, [("text", "Okay.")])



class EchoDetectionTests(unittest.TestCase):
    def test_a_prompt_echo_is_caught(self):
        from speech.stt import looks_like_echo

        echo = "Hey Travis. tusker L3, tusker L1, tusker L2, tusker L1, tusker L2, tusker L1, tusker L1, tusker L2, tusker L1"
        self.assertTrue(looks_like_echo(echo, 2.2))
        self.assertTrue(looks_like_echo("tusker edge tusker edge tusker edge tusker edge tusker edge", 6.0))  # repeats itself

    def test_real_commands_are_not(self):
        from speech.stt import looks_like_echo

        for text, secs in (("Hey Travis, volume up.", 1.8), ("Hey Travis, set tusker edge to eighty percent.", 3.2),
                           ("Hey Travis, set the AC to twenty four and turn on tusker edge and lock the door.", 6.5),
                           ("Hey Travis, turn on tusker L1, tusker L2 and tusker edge.", 4.0)):
            with self.subTest(text=text):
                self.assertFalse(looks_like_echo(text, secs))


if __name__ == "__main__":
    unittest.main()
