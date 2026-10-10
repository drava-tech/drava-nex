import sys
import tempfile
import unittest
import wave
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from agent import utterance_store  # noqa: E402


class UtteranceStoreTests(unittest.TestCase):
    def test_saves_a_readable_wav_and_keeps_only_the_newest(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "utterances"
            names = []
            for i in range(5):
                names.append(utterance_store.save(d, b"\x01\x00" * 1600, 16000, keep=3))
                (d / names[-1]).rename(d / f"utt_{1000 + i}.wav")  # distinct, ordered names
                names[-1] = f"utt_{1000 + i}.wav"
                utterance_store._prune(d, 3)
            left = sorted(p.name for p in d.glob("utt_*.wav"))
            self.assertEqual(left, ["utt_1002.wav", "utt_1003.wav", "utt_1004.wav"])
            with wave.open(str(d / left[0]), "rb") as w:
                self.assertEqual((w.getnchannels(), w.getframerate(), w.getnframes()), (1, 16000, 1600))

    def test_a_failure_to_save_never_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            blocker = Path(tmp) / "file"
            blocker.write_text("x")
            self.assertEqual(utterance_store.save(blocker / "sub", b"\x00\x00", 16000), "")


if __name__ == "__main__":
    unittest.main()
