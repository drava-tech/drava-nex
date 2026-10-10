"""The command-shaped prompt is tried first; when it is unsure, the plain names prompt gets a second go
and the more confident transcript wins (the sentence prompt dragged "Hi" towards "Turn on")."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

import numpy as np  # noqa: E402

from speech.stt import WhisperSTT  # noqa: E402

SENTENCES = "Hey Travis. Turn off X. Turn on the AC."
NAMES = "Hey Travis. X, Y."


class FakeModel:
    """Says what a prompt makes it say: (text, avg_logprob) per initial_prompt."""

    def __init__(self, by_prompt):
        self.by_prompt = by_prompt
        self.prompts_seen = []

    def transcribe(self, audio, language=None, initial_prompt=None, **_):
        self.prompts_seen.append(initial_prompt)
        text, lp = self.by_prompt[initial_prompt]
        seg = SimpleNamespace(text=text, avg_logprob=lp, no_speech_prob=0.05)
        info = SimpleNamespace(language="en", language_probability=0.9, all_language_probs=[("en", 0.9)])
        return iter([seg]), info


def _stt(model, retry_below=-0.30):
    s = object.__new__(WhisperSTT)
    s._model = model
    s._hotwords = None
    s._initial_prompt = SENTENCES
    s._beam_size = 1
    s._reject_threshold = 0.5
    s._english_floor = 0.15
    s._single_pass = True
    s._fallback_prompt = NAMES
    s._retry_below = retry_below
    return s


AUDIO = (np.zeros(16000, dtype=np.int16)).tobytes()


class FallbackTests(unittest.TestCase):
    def test_a_confident_first_decode_is_final_and_costs_nothing_extra(self):
        m = FakeModel({SENTENCES: ("Hey Travis. Turn off X.", -0.08), NAMES: ("something else", -0.1)})
        t = _stt(m).transcribe(AUDIO)
        self.assertEqual(t.text, "Hey Travis. Turn off X.")
        self.assertFalse(t.used_fallback_prompt)
        self.assertEqual(len(m.prompts_seen), 1)

    def test_an_unsure_first_decode_is_replaced_by_the_more_confident_fallback(self):
        m = FakeModel({SENTENCES: ("Hey Travis. Turn on.", -0.51), NAMES: ("Hey Travis. Hi.", -0.20)})
        t = _stt(m).transcribe(AUDIO)
        self.assertEqual(t.text, "Hey Travis. Hi.")
        self.assertTrue(t.used_fallback_prompt)
        self.assertAlmostEqual(t.avg_logprob, -0.20)

    def test_the_fallback_only_wins_if_it_is_actually_more_confident(self):
        m = FakeModel({SENTENCES: ("Hey Travis. Turn off X.", -0.40), NAMES: ("Hey Travis. garbage", -0.90)})
        t = _stt(m).transcribe(AUDIO)
        self.assertEqual(t.text, "Hey Travis. Turn off X.")
        self.assertFalse(t.used_fallback_prompt)

    def test_it_can_be_switched_off(self):
        m = FakeModel({SENTENCES: ("Hey Travis. Turn on.", -0.51), NAMES: ("Hey Travis. Hi.", -0.20)})
        t = _stt(m, retry_below=None).transcribe(AUDIO)
        self.assertEqual(t.text, "Hey Travis. Turn on.")
        self.assertEqual(len(m.prompts_seen), 1)


if __name__ == "__main__":
    unittest.main()
