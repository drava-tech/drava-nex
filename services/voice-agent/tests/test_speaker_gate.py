import unittest

import numpy as np

from core import speaker


class SpeakerMathTests(unittest.TestCase):
    """Cosine/blend are the gate's decision math and need no model to test."""

    def test_cosine_identical_is_one(self):
        v = np.array([0.1, -0.2, 0.9, 0.3], dtype=np.float32)
        self.assertAlmostEqual(speaker.cosine(v, v), 1.0, places=5)

    def test_cosine_orthogonal_is_zero(self):
        a = np.array([1.0, 0.0], dtype=np.float32)
        b = np.array([0.0, 1.0], dtype=np.float32)
        self.assertAlmostEqual(speaker.cosine(a, b), 0.0, places=6)

    def test_cosine_same_speaker_beats_different(self):
        # Two noisy reads of the "same" voice should score higher than a
        # clearly different direction — the property the gate relies on.
        target = np.array([0.9, 0.1, 0.1, 0.2], dtype=np.float32)
        same = target + np.array([0.02, -0.01, 0.0, 0.03], dtype=np.float32)
        other = np.array([-0.3, 0.8, -0.2, 0.1], dtype=np.float32)
        self.assertGreater(speaker.cosine(target, same), speaker.cosine(target, other))

    def test_cosine_handles_none_and_zero(self):
        self.assertEqual(speaker.cosine(None, np.ones(3)), 0.0)
        self.assertEqual(speaker.cosine(np.zeros(3), np.ones(3)), 0.0)

    def test_blend_stays_unit_norm_and_moves_toward_new(self):
        target = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        new = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        out = speaker.blend(target, new, weight=0.2)
        self.assertAlmostEqual(float(np.linalg.norm(out)), 1.0, places=5)
        # After nudging toward `new`, similarity to `new` should rise.
        self.assertGreater(speaker.cosine(out, new), speaker.cosine(target, new))


class SpeakerEmbedTests(unittest.TestCase):
    def test_embed_roundtrip_when_available(self):
        if not speaker.available():
            self.skipTest("resemblyzer/model not installed")
        # 1s of a 220 Hz tone at 16 kHz — a stable 'voice' should embed and be
        # highly self-similar across two reads of the same signal.
        sr = 16000
        t = np.arange(sr, dtype=np.float32) / sr
        tone = (0.3 * np.sin(2 * np.pi * 220 * t) * 32767).astype(np.int16)
        e1 = speaker.embed(tone.tobytes(), sr)
        e2 = speaker.embed(tone.tobytes(), sr)
        self.assertIsNotNone(e1)
        self.assertIsNotNone(e2)
        self.assertGreater(speaker.cosine(e1, e2), 0.9)

    def test_embed_rejects_too_short(self):
        if not speaker.available():
            self.skipTest("resemblyzer/model not installed")
        tiny = np.zeros(64, dtype=np.int16).tobytes()
        self.assertIsNone(speaker.embed(tiny, 16000))

    def test_embed_rejects_silence_and_noise(self):
        if not speaker.available():
            self.skipTest("resemblyzer/model not installed")
        # Pure silence (1s) and faint mic noise (1s) must not produce embeddings
        silence = np.zeros(16000, dtype=np.int16).tobytes()
        self.assertIsNone(speaker.embed(silence, 16000))
        noise = (np.random.randn(16000) * 20).astype(np.int16).tobytes()
        self.assertIsNone(speaker.embed(noise, 16000))


if __name__ == "__main__":
    unittest.main()
