import unittest

from speech.transcript_gate import (
    has_speech_beyond_wake_word,
    is_noise,
    mentions_wake_word,
    strip_markers,
)


class WakeWordInTranscriptTests(unittest.TestCase):
    def test_matches_gemini_spellings_seen_live(self):
        for text in ("Travis, can you hear me?", "Ravis, can you hear me?", "Tra vis can you hear me", "Travis."):
            self.assertTrue(mentions_wake_word(text), text)

    def test_no_match_without_the_wake_word(self):
        self.assertFalse(mentions_wake_word("So that is for the la st week and you hear me"))
        self.assertFalse(mentions_wake_word("we need to travel is that ok"))
        self.assertFalse(mentions_wake_word(""))


class SpeechBeyondWakeWordTests(unittest.TestCase):
    def test_wake_word_alone_is_not_a_command(self):
        for text in ("Travis", "Travis.", "Tra vis.", "Travis, <noise>"):
            self.assertFalse(has_speech_beyond_wake_word(text), text)

    def test_any_other_word_is(self):
        self.assertTrue(has_speech_beyond_wake_word("Travis, lights on"))
        self.assertTrue(has_speech_beyond_wake_word("ఎవరు"))


class NoiseTests(unittest.TestCase):
    def test_markers_only_is_noise(self):
        self.assertTrue(is_noise("<noise>"))
        self.assertTrue(is_noise(" <noise> . "))

    def test_words_or_empty_are_not_noise(self):
        self.assertFalse(is_noise("<noise> lights on"))
        self.assertFalse(is_noise(""))

    def test_strip_markers(self):
        self.assertEqual(strip_markers("<noise> hi").strip(), "hi")


class HeyTravisPhraseTests(unittest.TestCase):
    PHRASE = "hey travis"

    def test_whisper_hearing_the_name_is_enough(self):
        from speech.transcript_gate import mentions_wake_word

        for text in ("Hey Travis, lights on", "Hey, Travis.", "A Travis lights on", "Travis, lights on"):
            with self.subTest(text=text):
                self.assertTrue(mentions_wake_word(text, self.PHRASE))
        self.assertFalse(mentions_wake_word("hey there, lights on", self.PHRASE))

    def test_hey_travis_alone_is_not_a_command(self):
        from speech.transcript_gate import has_speech_beyond_wake_word

        for text in ("Hey Travis", "Hey Travis.", "Hey, Travis!", "Hey Tra vis"):
            with self.subTest(text=text):
                self.assertFalse(has_speech_beyond_wake_word(text, self.PHRASE))
        self.assertTrue(has_speech_beyond_wake_word("Hey Travis, lights on", self.PHRASE))

    def test_the_wake_phrase_is_stripped_from_the_command(self):
        from speech.transcript_gate import strip_wake_word

        self.assertEqual(strip_wake_word("Hey Travis, turn on the lights.", self.PHRASE), "turn on the lights")
        self.assertEqual(strip_wake_word("Hey, Trevis lock the door", self.PHRASE), "lock the door")
        self.assertEqual(strip_wake_word("turn off tusker edge, hey Travis", self.PHRASE), "turn off tusker edge")


if __name__ == "__main__":
    unittest.main()
