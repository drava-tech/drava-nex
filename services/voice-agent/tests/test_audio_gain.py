import sys
import unittest
from pathlib import Path

import numpy as np

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from audio.devices import apply_gain


def _pcm(values):
    return np.array(values, dtype=np.int16).tobytes()


def _samples(pcm):
    return np.frombuffer(pcm, dtype=np.int16).tolist()


class ApplyGainTests(unittest.TestCase):
    def test_unity_gain_leaves_audio_untouched(self):
        pcm = _pcm([0, 100, -100, 32767])
        self.assertEqual(apply_gain(pcm, 1.0), pcm)

    def test_gain_scales_samples(self):
        self.assertEqual(_samples(apply_gain(_pcm([100, -200, 0]), 2.0)), [200, -400, 0])

    def test_loud_samples_clip_instead_of_wrapping_around(self):
        # int16 overflow would turn a loud positive peak into a negative one
        # (a harsh crack); it must saturate at the limits instead.
        out = _samples(apply_gain(_pcm([30000, -30000]), 2.0))
        self.assertEqual(out, [32767, -32768])

    def test_empty_audio_is_fine(self):
        self.assertEqual(apply_gain(b"", 2.0), b"")


if __name__ == "__main__":
    unittest.main()
