"""The smart end-of-speech detector (speech/endpointing.py), with a scripted VAD and a scripted Smart Turn."""

import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import numpy as np

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from speech.endpointing import FRAME, SmartEndpointer, make_endpointer  # noqa: E402
from speech.vad import Endpointer  # noqa: E402


class EnergyVAD:
    """Speech = a frame with real energy; a stand-in for Silero."""

    def __init__(self):
        self.resets = 0

    def reset(self):
        self.resets += 1

    def prob(self, frame):
        return 0.95 if int(np.abs(frame).max()) > 1000 else 0.02


class ScriptedTurn:
    """Smart Turn stand-in: returns `answer` (a number, or a function of the audio length in seconds)."""

    def __init__(self, answer):
        self.answer = answer
        self.calls = []

    def prob(self, audio):
        seconds = len(audio) / 16000
        self.calls.append(seconds)
        return self.answer(seconds) if callable(self.answer) else self.answer


def speech(frames, level=8000):
    return (np.sin(np.arange(frames * FRAME) * 0.3) * level).astype(np.int16).tobytes()


def silence(frames):
    return np.zeros(frames * FRAME, dtype=np.int16).tobytes()


def ms(n):  # frames for n milliseconds
    return max(1, round(n / 32))


def make(turn, **kw):
    kw.setdefault("gate_db", None)
    return SmartEndpointer(EnergyVAD(), turn, **kw)


def feed_all(ep, audio, step=1024):
    out = []
    for i in range(0, len(audio), step * 2):
        out += ep.feed(audio[i:i + step * 2])
    return out


class EndingTests(unittest.TestCase):
    def test_a_complete_turn_ends_at_the_pause_not_after_a_long_silence(self):
        turn = ScriptedTurn(0.97)
        ep = make(turn, pause_ms=450)
        out = feed_all(ep, speech(30) + silence(60))
        self.assertEqual(len(out), 1)
        self.assertEqual(ep.last_reason, "pause")
        seconds = len(out[0]) / 2 / 16000
        self.assertLess(seconds, 30 * 0.032 + 0.5)  # speech + ~200 ms tail (+ the pre-roll), never the whole silence
        self.assertGreater(seconds, 30 * 0.032)
        self.assertEqual(len(turn.calls), 1)

    def test_nothing_is_asked_before_the_pause_is_long_enough(self):
        turn = ScriptedTurn(0.99)
        ep = make(turn, pause_ms=450)
        self.assertEqual(feed_all(ep, speech(20) + silence(ms(450) - 3)), [])
        self.assertEqual(turn.calls, [])

    def test_an_unfinished_turn_keeps_listening_and_in_speech_stays_true(self):
        turn = ScriptedTurn(0.1)
        ep = make(turn, pause_ms=450, grace_ms=2500, recheck_ms=300)
        feed_all(ep, speech(20))
        self.assertTrue(ep.in_speech)
        out = []
        for _ in range(ms(2400)):  # a long pause, still inside the grace period
            out += ep.feed(silence(1))
            self.assertTrue(ep.in_speech, "the 'what do you need?' prompt must not fire during a pause")
        self.assertEqual(out, [])
        self.assertGreaterEqual(len(turn.calls), 5)  # asked again every ~300 ms

    def test_the_grace_period_ends_an_unfinished_turn(self):
        ep = make(ScriptedTurn(0.1), pause_ms=450, grace_ms=2500)
        out = feed_all(ep, speech(20) + silence(ms(2600)))
        self.assertEqual(len(out), 1)
        self.assertEqual(ep.last_reason, "grace")
        self.assertFalse(ep.in_speech)

    def test_a_turn_that_becomes_complete_during_the_pause_ends_then(self):
        ep = make(ScriptedTurn(lambda seconds: 0.2 if seconds < 1.4 else 0.95), pause_ms=450, recheck_ms=300)
        out = feed_all(ep, speech(20) + silence(ms(2000)))
        self.assertEqual(len(out), 1)
        self.assertEqual(ep.last_reason, "pause")

    def test_speech_that_resumes_after_a_pause_is_one_utterance(self):
        ep = make(ScriptedTurn(lambda seconds: 0.95 if seconds > 2.0 else 0.1), pause_ms=450)
        out = feed_all(ep, speech(15) + silence(ms(600)) + speech(30) + silence(ms(700)))
        self.assertEqual(len(out), 1)
        self.assertGreater(len(out[0]) / 2 / 16000, 15 * 0.032 + 0.6 + 30 * 0.032)

    def test_hard_cap(self):
        ep = make(ScriptedTurn(0.0), max_ms=2000)
        out = feed_all(ep, speech(120))
        self.assertEqual(len(out), 1)
        self.assertEqual(ep.last_reason, "cap")

    def test_input_in_odd_sized_pieces_gives_the_same_result(self):
        audio = speech(25) + silence(40)
        a, b = make(ScriptedTurn(0.97)), make(ScriptedTurn(0.97))
        out_a = feed_all(a, audio, step=1024)
        out_b = []
        for i in range(0, len(audio), 700):
            out_b += b.feed(audio[i:i + 700])
        self.assertEqual(out_a, out_b)

    def test_reset_forgets_the_utterance(self):
        ep = make(ScriptedTurn(0.1))
        feed_all(ep, speech(20))
        self.assertTrue(ep.in_speech)
        ep.reset()
        self.assertFalse(ep.in_speech)
        self.assertEqual(feed_all(ep, silence(40)), [])

    def test_stats_count_what_ended_each_utterance(self):
        ep = make(ScriptedTurn(0.97))
        feed_all(ep, speech(20) + silence(40))
        feed_all(ep, speech(20) + silence(40))
        self.assertEqual(ep.stats["pause"], 2)


class ExtraTriggerTests(unittest.TestCase):
    def test_the_loudness_gate_is_a_last_resort_when_the_vad_never_sees_a_pause(self):
        class AlwaysSpeech(EnergyVAD):  # noise the VAD cannot tell from speech
            def prob(self, frame):
                return 0.95

        turn = ScriptedTurn(0.99)
        ep = SmartEndpointer(AlwaysSpeech(), turn, gate_db=18.0, gate_end_ms=1500, max_ms=10000)
        loud = speech(20, level=9000)
        quiet = (np.random.default_rng(1).standard_normal(FRAME * ms(2200)) * 300).astype(np.int16).tobytes()  # ~30 dB below
        out = feed_all(ep, loud + quiet)
        self.assertEqual(len(out), 1)
        self.assertEqual(ep.last_reason, "gate-fallback")
        self.assertEqual(turn.calls, [])  # a last resort does not ask Smart Turn

    def test_the_gate_does_not_end_speech_that_stays_loud(self):
        class AlwaysSpeech(EnergyVAD):
            def prob(self, frame):
                return 0.95

        ep = SmartEndpointer(AlwaysSpeech(), ScriptedTurn(0.99), gate_db=18.0, gate_end_ms=1500, max_ms=60000)
        self.assertEqual(feed_all(ep, speech(200, level=9000)), [])

    def test_the_periodic_check_is_off_by_default_and_works_when_asked_for(self):
        class AlwaysSpeech(EnergyVAD):
            def prob(self, frame):
                return 0.95

        off = SmartEndpointer(AlwaysSpeech(), ScriptedTurn(0.99), gate_db=None, max_ms=60000)
        self.assertEqual(feed_all(off, speech(120)), [])
        turn = ScriptedTurn(0.95)
        on = SmartEndpointer(AlwaysSpeech(), turn, gate_db=None, max_ms=60000, interval_ms=300, interval_after_ms=1200, interval_threshold=0.9)
        out = feed_all(on, speech(120))  # 3.8 s of unbroken "speech": one utterance each time the check says complete
        self.assertGreaterEqual(len(out), 1)
        self.assertEqual(on.last_reason, "interval")
        self.assertGreater(turn.calls[0], 1.1)  # not before the utterance is 1.2 s long

    def test_the_periodic_check_respects_its_own_higher_threshold(self):
        class AlwaysSpeech(EnergyVAD):
            def prob(self, frame):
                return 0.95

        ep = SmartEndpointer(AlwaysSpeech(), ScriptedTurn(0.8), gate_db=None, max_ms=60000, interval_ms=300, interval_threshold=0.9)
        self.assertEqual(feed_all(ep, speech(120)), [])


class DefaultsTests(unittest.TestCase):
    def test_the_grace_period_is_three_seconds_and_the_gate_cannot_pre_empt_it(self):
        with mock.patch("speech.endpointing.SileroVAD", lambda *a, **k: EnergyVAD()),                 mock.patch("speech.endpointing.SmartTurn", lambda *a, **k: ScriptedTurn(0.1)), redirect_stdout(io.StringIO()):
            ep = make_endpointer({"endpointing": "smart"})
        self.assertEqual(ep._grace, ms(3000))
        self.assertGreaterEqual(ep._gate_end, ep._grace)  # the last-resort gate must not cut in before the grace period is over
        out = feed_all(ep, speech(20) + silence(ms(2900)))
        self.assertEqual(out, [])  # still waiting at 2.9 s
        out = feed_all(ep, silence(ms(300)))
        self.assertEqual(len(out), 1)
        self.assertEqual(ep.last_reason, "grace")


class FactoryTests(unittest.TestCase):
    def test_default_is_the_old_endpointer(self):
        self.assertIsInstance(make_endpointer({}), Endpointer)
        self.assertIsInstance(make_endpointer({"endpointing": "webrtc"}), Endpointer)

    def test_smart_without_its_models_falls_back_with_a_warning(self):
        with tempfile.TemporaryDirectory() as d, redirect_stdout(io.StringIO()) as out:
            ep = make_endpointer({"endpointing": "smart", "endpoint_models_dir": d})
        self.assertIsInstance(ep, Endpointer)
        self.assertIn("using the WebRTC endpointer", out.getvalue())

    def test_smart_reads_its_settings_from_the_config(self):
        with mock.patch("speech.endpointing.SileroVAD", lambda *a, **k: EnergyVAD()), \
                mock.patch("speech.endpointing.SmartTurn", lambda *a, **k: ScriptedTurn(0.5)), redirect_stdout(io.StringIO()):
            ep = make_endpointer({"endpointing": "smart", "endpoint_pause_ms": 640, "endpoint_grace_ms": 3200, "endpoint_max_ms": 8000,
                                  "endpoint_gate_db": 0, "endpoint_interval_ms": 400})
        self.assertIsInstance(ep, SmartEndpointer)
        self.assertEqual((ep._pause, ep._grace, ep._max), (20, 100, 250))
        self.assertIsNone(ep._gate_db)
        self.assertEqual(ep._interval, 12)


MODELS = AGENT_ROOT / "audio" / "models"


@unittest.skipUnless((MODELS / "silero_vad.onnx").exists() and (MODELS / "smart-turn-v3.2-cpu.onnx").exists(), "models not downloaded")
class RealModelTests(unittest.TestCase):
    def test_a_real_command_followed_by_silence_ends_by_a_pause(self):
        import wave

        clips = sorted((AGENT_ROOT / "bench" / "recordings" / "endpointing").glob("utt_*.wav"))
        if not clips:
            self.skipTest("no benchmark clips")
        with wave.open(str(clips[0])) as w:
            pcm = w.readframes(w.getnframes())
        with redirect_stdout(io.StringIO()):
            ep = make_endpointer({"endpointing": "smart"})
        out = feed_all(ep, pcm + silence(ms(6000)))
        self.assertGreaterEqual(len(out), 1)
        self.assertIn(ep.last_reason, ("pause", "grace"))


if __name__ == "__main__":
    unittest.main()
