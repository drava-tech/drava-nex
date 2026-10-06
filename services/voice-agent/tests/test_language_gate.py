import unittest

from speech.language_gate import is_english


class LanguageGateTests(unittest.TestCase):
    def test_accepts_plain_english(self):
        self.assertTrue(is_english("turn on the lights"))
        self.assertTrue(is_english("lock the door"))
        self.assertTrue(is_english("Travis"))

    def test_fails_open_on_empty_or_too_short(self):
        self.assertTrue(is_english(""))
        self.assertTrue(is_english("ok"))
        self.assertTrue(is_english("42"))

    def test_rejects_devanagari_hindi(self):
        self.assertFalse(is_english("लाइट बंद करो"))

    def test_rejects_telugu(self):
        self.assertFalse(is_english("దీపం ఆన్ చేయి"))

    def test_rejects_urdu_arabic_script(self):
        self.assertFalse(is_english("روشنی بند کرو"))

    def test_rejects_short_words_entirely_in_another_script(self):
        # Seen live: Gemini transcribed "सर" / "ఎవరు" — too short for the
        # ratio check, but every letter is non-Latin.
        self.assertFalse(is_english("सर"))
        self.assertFalse(is_english("ఎవరు"))

    def test_rejects_any_non_latin_language(self):
        self.assertFalse(is_english("включи свет"))
        self.assertFalse(is_english("开灯"))

    def test_accepts_mostly_english_with_a_stray_non_latin_char(self):
        # A single stray character (e.g. a name) shouldn't flip a genuinely
        # English command to rejected.
        self.assertTrue(is_english("turn on the lights é"))


if __name__ == "__main__":
    unittest.main()
