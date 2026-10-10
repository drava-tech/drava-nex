"""nlu/followup.py: "tell me more" and its kin continue the last answer instead of reaching the planner (which read it as a cut-off sentence)."""

import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.followup import is_more_request, normalise  # noqa: E402
from tests.test_knowledge_answer import CONTACT, Fixture, company  # noqa: E402

MORE = [
    "tell me more", "Tell me more.", "tell me more about it", "tell me more about that", "tell me more about them", "can you tell me more",
    "Can you tell me more about it", "could you tell me more about that?", "more", "More details", "more about that", "what else",
    "What else?", "go on", "Go on.", "continue", "anything else", "Anything else?", "and?", "say more", "tell more",
    "Okay, tell me more please", "um, so what else", "hey travis, tell me more", "yeah go on",
]
NOT_MORE = [
    "more light", "turn on more lights", "go on the main screen", "continue the presentation on tusker 86", "tell me more lights", "what else is on",
    "tell me about white tusker", "who founded it", "make it brighter", "", "tell me", "more or less",
]


class PhraseTests(unittest.TestCase):
    def test_every_listed_phrase_matches_whatever_the_filler_or_punctuation(self):
        for t in MORE:
            with self.subTest(t=t):
                self.assertTrue(is_more_request(t))

    def test_anything_with_another_subject_or_a_device_word_does_not(self):
        for t in NOT_MORE:
            with self.subTest(t=t):
                self.assertFalse(is_more_request(t))

    def test_normalising(self):
        self.assertEqual(normalise("Okay, Tell me MORE, please!"), "tell me more")
        self.assertEqual(normalise("and?"), "and")  # a lone "and" is the request itself
        self.assertEqual(normalise("what’s else"), "what's else")


class FlowTests(unittest.TestCase):
    def conversation(self, extra_plans, answers):
        f = Fixture(self, [company(), *extra_plans], answers)
        f.ask("tell me about white tusker")
        return f

    def test_tell_me_more_continues_with_new_sections_and_never_reaches_the_planner(self):
        f = self.conversation([company(query="more about White Tusker")],
                              [{"found": True, "answer": "White Tusker is a studio."}, {"found": True, "answer": "Boeing, Bosch, Volvo and Infosys are clients across technology and automotive sectors."}])
        said = f.ask("Tell me more")
        self.assertEqual(said, "Boeing, Bosch, Volvo and Infosys are clients across technology and automotive sectors.")
        self.assertEqual(len(f.a.chat.requests), 1)  # only the first question was planned
        self.assertTrue(f.searches[-1]["exclude"])  # the sections already used were skipped
        self.assertNotIn(CONTACT, said)

    def test_log_example_can_you_tell_me_more_about_it(self):
        f = self.conversation([company(query="more about White Tusker")],
                              [{"found": True, "answer": "White Tusker is a studio."}, {"found": True, "answer": "Boeing, Bosch and Volvo are clients across technology and automotive sectors."}])
        self.assertEqual(f.ask("Can you tell me more about it"), "Boeing, Bosch and Volvo are clients across technology and automotive sectors.")

    def test_more_is_forced_even_if_the_rewrite_does_not_flag_it(self):
        for phrase in ("more", "what else", "go on", "tell me more"):
            with self.subTest(phrase=phrase):
                f = self.conversation([company(query="more about White Tusker", wants_more=False)],
                                      [{"found": True, "answer": "White Tusker is a studio."}, {"found": True, "answer": "Boeing, Bosch and Infosys are clients across technology sectors."}])
                self.assertEqual(f.ask(phrase), "Boeing, Bosch and Infosys are clients across technology sectors.")
                self.assertEqual(f.searches[-1]["min_score"], 0.0)

    def test_nothing_left_keeps_the_all_i_have_wording(self):
        f = self.conversation([company(query="more about White Tusker")], [{"found": True, "answer": "White Tusker is a studio."}, {"found": False, "answer": ""}])
        self.assertTrue(f.ask("tell me more").startswith("That's all I have on that."))

    def test_with_nothing_said_before_it_asks_what_about_and_does_not_plan(self):
        f = Fixture(self, [], [])
        said = f.ask("tell me more")
        self.assertIn("What would you like to know more about?", said)
        self.assertNotIn("mid-sentence", said)
        self.assertEqual(f.a.chat.requests, [])

    def test_after_a_command_with_no_answer_it_asks_too(self):
        f = Fixture(self, [], [])
        f.a._remember("turn on the cove light", "cove light is on.")  # a command, not a knowledge answer
        self.assertIn("What would you like to know more about?", f.ask("what else"))

    def test_a_device_look_alike_is_still_planned(self):
        f = Fixture(self, [company()], [{"found": True, "answer": "x"}])
        f.ask("more light")
        self.assertEqual(len(f.a.chat.requests), 1)


if __name__ == "__main__":
    unittest.main()
