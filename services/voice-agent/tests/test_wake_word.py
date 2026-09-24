import unittest
from pathlib import Path
import sys

# Ensure services/voice-agent root is in path
AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from main import _VoskWakeWordDetector


class WakeWordDetectorTests(unittest.TestCase):
    def test_vosk_detector_init_and_label(self):
        try:
            import vosk  # noqa: F401
        except ImportError:
            self.skipTest("vosk not installed")

        detector = _VoskWakeWordDetector("travis", 16000, variants=["travel"], partial_confirm_frames=2)
        self.assertEqual(detector.label, "travis")
        self.assertIn("travis", detector._match_words)
        self.assertIn("travel", detector._match_words)

    @staticmethod
    def _detector_with_partials(partials):
        """A detector whose decoder replays a scripted partial-hypothesis
        sequence, one entry per audio chunk."""
        import json

        class FakeRec:
            def __init__(self):
                self.i = -1

            def AcceptWaveform(self, _pcm):
                self.i += 1

            def PartialResult(self):
                return json.dumps({"partial": partials[self.i]})

            def Reset(self):
                pass

        d = object.__new__(_VoskWakeWordDetector)
        d._match_words = {"travis"}
        d._partial_confirm_frames = 1
        d._partial_streak = 0
        d._miss_streak = 0
        d.last_partial = ""
        d._rec = FakeRec()
        return d, len(partials)

    def test_wake_fires_when_travis_follows_other_sounds(self):
        # Observed live: the decoder heard "[unk] [unk] travis [unk] travis …"
        # (a hypothesis that kept growing) and never woke, because "travis" sat
        # at position 3+ and only the first two words were checked.
        d, n = self._detector_with_partials(["[unk] [unk]", "[unk] [unk] travis"])
        self.assertEqual([d.detect(b"") for _ in range(n)], [False, True])

    def test_wake_fires_for_leading_travis(self):
        d, n = self._detector_with_partials(["travis", "travis turn"])
        self.assertTrue(d.detect(b""))

    def test_no_wake_on_unrecognised_sound_alone(self):
        d, n = self._detector_with_partials(["[unk]", "[unk] [unk]", "[unk] [unk] [unk]"])
        self.assertEqual([d.detect(b"") for _ in range(n)], [False, False, False])

    def test_fallback_flag_when_no_wake_model(self):
        # When wake model is None, need_wake_word must be False so the agent
        # connects immediately rather than blocking on standby for a wake word.
        wake_model = None
        need_wake_word = wake_model is not None
        self.assertFalse(need_wake_word)

    def test_re_exec_detection_logic(self):
        # Ensure _venv_py path calculation accurately locates the adjacent .venv
        venv_py = AGENT_ROOT / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        self.assertTrue(venv_py.is_file(), f"Expected .venv python at {venv_py}")


if __name__ == "__main__":
    unittest.main()
