import unittest

from bench import stt_diag as d


class ScoringTests(unittest.TestCase):
    def test_number_words_become_digits(self):
        self.assertEqual(d.words_to_digits("twenty four"), "24")
        self.assertEqual(d.words_to_digits("twenty-five degrees"), "25 degrees")
        self.assertEqual(d.words_to_digits("seventy five percent"), "75 percent")
        self.assertEqual(d.words_to_digits("thirty"), "30")

    def test_spoken_and_digit_forms_match(self):
        s = d.score("Hey Travis, set the AC to twenty four", "Hey Travis, set the A/C to 24.")
        self.assertTrue(s["exact"] and s["numbers_ok"] and s["wake_heard"])

    def test_wrong_number_is_flagged(self):
        s = d.score("set the lights to seventy five percent", "set the lights to fifteen percent")
        self.assertFalse(s["numbers_ok"])
        self.assertEqual(s["numbers_heard"], ["15"])

    def test_dropped_word_counts(self):
        s = d.score("turn on the lights and switch on the screen", "turn on the lights and the screen")
        self.assertGreater(s["wer"], 0)
        self.assertEqual(s["dropped"], [])  # "on" still present once; only a word count drop
        self.assertEqual(s["added"], [])

    def test_synonyms(self):
        self.assertEqual(d.normalize("turn off the air conditioner"), d.normalize("turn off the AC"))
        self.assertEqual(d.normalize("switch on the a c"), d.normalize("turn on the AC"))

    def test_command_sets_have_what_was_asked_for(self):
        items = d.build_command_set(["tusker L1"], wake=True)
        text = " ".join(i["text"] for i in items)
        for n in ("twenty degrees", "forty percent", "seventy five", "ninety", "twenty-five", "lock", "unlock", "pause"):
            self.assertIn(n, text)
        self.assertGreaterEqual(len(items), 30)
        self.assertTrue(all(i["say"].startswith("Hey Travis, ") for i in items))
        self.assertEqual({c["condition_code"] for c in d.build_condition_set(True)}, set("ABCDEFGHI"))


class AudioStatsTests(unittest.TestCase):
    def test_silence_and_tone(self):
        import numpy as np

        t = np.arange(16000) / 16000
        tone = (np.sin(2 * np.pi * 300 * t) * 8000).astype(np.int16).tobytes()
        s = d.audio_stats(tone)
        self.assertAlmostEqual(s["seconds"], 1.0, places=1)
        self.assertGreater(s["peak_dbfs"], -15)


if __name__ == "__main__":
    unittest.main()
