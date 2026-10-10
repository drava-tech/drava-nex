"""The question-word rule for FAQ matching (nlu/faq_question_type.py) and the question_type field of knowledge/faq.yaml."""

import unittest
from pathlib import Path

import yaml

from nlu.faq_question_type import compatible, question_type

FAQ = yaml.safe_load((Path(__file__).resolve().parent.parent / "knowledge" / "faq.yaml").read_text(encoding="utf-8"))
ENTRIES = {e["id"]: e for e in FAQ["entries"] + FAQ["no_info"]}


class QuestionTypeTest(unittest.TestCase):
    def test_question_words(self):
        for text, kind in [
            ("Who founded White Tusker", "who"),
            ("When was White Tusker founded", "when"),
            ("In which year did you begin", "when"),
            ("Since when are you in business", "when"),
            ("Where are you located", "where"),
            ("In which city is White Tusker based", "where"),
            ("What is White Tusker", "what"),
            ("Which all companies you have worked with", "what"),
            ("How many people are there in the studio", "how_many"),
            ("How much do you charge", "how_many"),
            ("How do you work", "how"),
            ("How long ago was the studio established", "how"),
        ]:
            with self.subTest(text):
                self.assertEqual(question_type(text), kind)

    def test_no_question_word(self):
        for text in ["Founders", "Tell me about your team", "Can you hear me", "Pricing", ""]:
            with self.subTest(text):
                self.assertIsNone(question_type(text))

    def test_a_question_word_deep_in_a_statement_is_ignored(self):
        self.assertIsNone(question_type("Tell me everything you know about the studio and the people when you can"))


class FoundedWhoWhenTest(unittest.TestCase):
    """"Who founded" is answered; "when was it founded" is not in the knowledge. They are 0.96 similar, so the question word decides."""

    def test_who_founded_goes_to_the_founders_not_the_year(self):
        self.assertTrue(compatible("Who founded White Tusker", ENTRIES["company_founders"]["question_type"]))
        self.assertFalse(compatible("Who founded White Tusker", ENTRIES["ni_founding_year"]["question_type"]))

    def test_when_founded_goes_to_the_year_not_the_founders(self):
        self.assertTrue(compatible("When was White Tusker founded", ENTRIES["ni_founding_year"]["question_type"]))
        self.assertFalse(compatible("When was White Tusker founded", ENTRIES["company_founders"]["question_type"]))

    def test_when_founded_is_a_no_info_variant(self):
        self.assertEqual(ENTRIES["ni_founding_year"]["type"], "no_info")
        self.assertIn("When was White Tusker founded", ENTRIES["ni_founding_year"]["variants"])
        self.assertTrue(ENTRIES["ni_founding_year"]["answer"].startswith("I don't have that detail."))


class FaqFileTest(unittest.TestCase):
    def test_every_variant_is_compatible_with_its_own_entry(self):
        for eid, e in ENTRIES.items():
            for v in e["variants"]:
                with self.subTest(f"{eid}: {v}"):
                    self.assertTrue(compatible(v, e["question_type"]))

    def test_every_entry_has_a_question_type_list(self):
        for eid, e in ENTRIES.items():
            with self.subTest(eid):
                self.assertIsInstance(e["question_type"], list)

    def test_no_empty_unknown_types(self):
        allowed = {"who", "when", "where", "what", "how_many", "how"}
        for eid, e in ENTRIES.items():
            self.assertLessEqual(set(e["question_type"]), allowed, eid)


if __name__ == "__main__":
    unittest.main()
