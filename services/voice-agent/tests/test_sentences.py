"""nlu/sentences.py: the sentence splitter for streamed answers, and the merging of very short sentences before the grounding check."""

import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.sentences import SentenceSplitter, merge_short, split, word_count  # noqa: E402


class SplitTests(unittest.TestCase):
    def test_plain_sentences(self):
        self.assertEqual(split("We design spaces. We build systems! Do you want more?"), ["We design spaces.", "We build systems!", "Do you want more?"])

    def test_a_decimal_is_not_a_boundary(self):
        self.assertEqual(split("The screen is 2.5 metres wide. It is bright."), ["The screen is 2.5 metres wide.", "It is bright."])
        self.assertEqual(split("It is at 99.9 percent. Done."), ["It is at 99.9 percent.", "Done."])

    def test_common_abbreviations_do_not_end_a_sentence(self):
        for text, first in [
            ("Dr. Rao leads the studio. It is in Bengaluru.", "Dr. Rao leads the studio."),
            ("Mr. Parikh and Mrs. Attavar are directors. They lead it.", "Mr. Parikh and Mrs. Attavar are directors."),
            ("Some clients, e.g. Boeing and Volvo, come back. Others do not.", "Some clients, e.g. Boeing and Volvo, come back."),
            ("It handles lights, i.e. the cove light. It handles the AC.", "It handles lights, i.e. the cove light."),
            ("Media, files, etc. Are all kept in the library. Next.", "Media, files, etc. Are all kept in the library."),
            ("We open at 9 a.m. And close at 6 p.m. Come by.", "We open at 9 a.m. And close at 6 p.m. Come by."),  # an abbreviation never ends a sentence
        ]:
            with self.subTest(text):
                self.assertEqual(split(text)[0], first)

    def test_initials_do_not_end_a_sentence(self):
        self.assertEqual(split("Naveen D. C. Parikh is a director. He leads technology."), ["Naveen D. C. Parikh is a director.", "He leads technology."])
        self.assertEqual(split("J. K. Rowling was here. Really."), ["J. K. Rowling was here.", "Really."])

    def test_an_address_is_not_a_boundary(self):
        self.assertEqual(split("See thewhitetusker.com for more. Thanks."), ["See thewhitetusker.com for more.", "Thanks."])

    def test_a_streamed_sentence_is_complete_only_when_the_next_one_starts(self):
        s = SentenceSplitter()
        out = []
        for chunk in ["We design", " spaces", ".", " We build", " things", ". Last one"]:
            out += s.feed(chunk)
        self.assertEqual(out, ["We design spaces.", "We build things."])
        self.assertEqual(s.finish(), ["Last one"])

    def test_the_end_of_the_stream_releases_the_last_sentence(self):
        s = SentenceSplitter()
        self.assertEqual(s.feed("Only one sentence."), [])
        self.assertEqual(s.finish(), ["Only one sentence."])

    def test_a_streamed_decimal_split_across_chunks(self):
        s = SentenceSplitter()
        out = []
        for chunk in ["It is 2", ".", "5 metres wide", ". Yes."]:
            out += s.feed(chunk)
        self.assertEqual(out, ["It is 2.5 metres wide."])


class MergeTests(unittest.TestCase):
    def test_a_short_sentence_joins_the_next(self):
        self.assertEqual(merge_short(["Sure.", "White Tusker designs spaces that respond to people."]), ["Sure. White Tusker designs spaces that respond to people."])

    def test_a_long_sentence_stands_alone(self):
        s = ["White Tusker is a brand experience design studio.", "It works with Boeing and Volvo."]
        self.assertEqual(merge_short(s), s)

    def test_the_last_sentence_is_never_merged_forward(self):
        self.assertEqual(merge_short(["White Tusker is a brand experience design studio.", "Yes."]), ["White Tusker is a brand experience design studio.", "Yes."])

    def test_two_short_ones_in_a_row_become_one_group(self):
        self.assertEqual(merge_short(["Yes.", "Quite so.", "We design spaces that respond to people and events."]),
                         ["Yes. Quite so. We design spaces that respond to people and events."])

    def test_word_count(self):
        self.assertEqual(word_count("It is 2.5 metres wide."), 6)


if __name__ == "__main__":
    unittest.main()
