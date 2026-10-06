import unittest

from audio import target_speaker_gpu


class TargetSpeakerGpuFailOpenTests(unittest.TestCase):
    """This backend is experimental and opt-in (main.py's
    speaker_extraction_backend config key defaults to "resemblyzer") — on a
    machine without torch/speechbrain/CUDA it must fail open exactly like
    audio/speaker.py does, never raise, so the default Resemblyzer path is
    unaffected."""

    def test_extract_handles_missing_backend_gracefully(self):
        pcm = (b"\x00\x01" * 8000)
        result_pcm, score, elapsed_ms = target_speaker_gpu.extract(pcm, 16000, None)
        self.assertIsNone(result_pcm)
        self.assertEqual(score, 0.0)
        self.assertGreaterEqual(elapsed_ms, 0.0)

    def test_extract_handles_empty_pcm(self):
        result_pcm, score, elapsed_ms = target_speaker_gpu.extract(b"", 16000, None)
        self.assertIsNone(result_pcm)

    def test_available_is_a_bool(self):
        self.assertIsInstance(target_speaker_gpu.available(), bool)


if __name__ == "__main__":
    unittest.main()
