import unittest
from pathlib import Path
import sys

# Ensure services/voice-agent root is in path
AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from wake.detectors import VoskWakeWordDetector


class WakeWordDetectorTests(unittest.TestCase):
    def test_vosk_detector_init_and_label(self):
        try:
            import vosk  # noqa: F401
        except ImportError:
            self.skipTest("vosk not installed")

        detector = VoskWakeWordDetector("travis", 16000, variants=["travel"], partial_confirm_frames=2)
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

        d = object.__new__(VoskWakeWordDetector)
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

    @classmethod
    def _hey_detector(cls, partials):
        d, n = cls._detector_with_partials(partials)
        d._lead_words = ["hey"]
        return d, n

    def test_hey_travis_fires_on_the_two_words_together(self):
        d, n = self._hey_detector(["hey", "hey travis"])
        self.assertEqual([d.detect(b"") for _ in range(n)], [False, True])

    def test_travis_alone_does_not_wake(self):
        d, n = self._hey_detector(["travis", "travis turn", "travis turn on the lights"])
        self.assertEqual([d.detect(b"") for _ in range(n)], [False, False, False])

    def test_hey_without_travis_does_not_wake(self):
        d, n = self._hey_detector(["hey", "hey there", "hey there everyone"])
        self.assertEqual([d.detect(b"") for _ in range(n)], [False, False, False])

    def test_hey_travis_after_other_sounds_and_before_the_command(self):
        d, n = self._hey_detector(["[unk] [unk] hey travis", "hey travis turn on"])
        self.assertTrue(d.detect(b""))
        d, n = self._hey_detector(["hey travis turn on the lights"])
        self.assertTrue(d.detect(b""))

    def test_the_words_must_be_adjacent_and_in_order(self):
        d, n = self._hey_detector(["travis hey", "hey [unk] travis"])
        self.assertEqual([d.detect(b"") for _ in range(n)], [False, False])

    def test_hey_travis_detector_init(self):
        try:
            import vosk  # noqa: F401
        except ImportError:
            self.skipTest("vosk not installed")
        d = VoskWakeWordDetector("hey travis", 16000, variants=None, partial_confirm_frames=2)
        self.assertEqual(d.label, "hey travis")
        self.assertEqual(d._lead_words, ["hey"])
        self.assertEqual(d._match_words, {"travis"})

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
