"""Punctuation, hyphens, spacing, case and accents never decide whether a name is found.

A spoken name is compared with the CMS's through nlu/names.py everywhere: experiences, media, screens, devices. These tests run the same families of variants
through every route (the shared key, the title matcher, the portfolio offer, the content push, the resolver), with real-looking awkward titles.
"""

import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu import title_match  # noqa: E402
from nlu.names import key, resolve, same  # noqa: E402
from tests.test_local_agent import _agent  # noqa: E402

# Titles as people actually type them into a CMS.
TITLES = [
    "The White Tusker PORT-FOLIO", "Dr. Who's Demo (v2)", "Q&A Session", "Café Menu", "Flight Data Art", "Future Shopping", "Welcome Reel 2024",
    "Welcome Reel 2025", "Tusker_86 Intro", "Brand — Film: Cut #3", "AI/ML Showcase", "50% Off Sale!", "WT_Logo_Reveal.mp4", "HMS_Pitch.pdf", "Travis Review.pptx", "canvas print.png",
]
# (what was said, the title it must mean)
SAID = [
    ("portfolio", "The White Tusker PORT-FOLIO"), ("port folio", "The White Tusker PORT-FOLIO"), ("white tusker portfolio", "The White Tusker PORT-FOLIO"),
    ("the white tusker port-folio", "The White Tusker PORT-FOLIO"), ("White Tusker PORTFOLIO", "The White Tusker PORT-FOLIO"),
    ("doctor who's demo v2", None),  # "doctor" is not "dr": a different word, so it is asked about, never guessed
    ("dr who's demo v2", "Dr. Who's Demo (v2)"), ("dr whos demo v 2", "Dr. Who's Demo (v2)"), ("Dr Who's Demo", "Dr. Who's Demo (v2)"),
    ("q and a session", "Q&A Session"), ("q&a session", "Q&A Session"), ("q a session", None),
    ("cafe menu", "Café Menu"), ("café menu", "Café Menu"), ("CAFE MENU", "Café Menu"),
    ("flight data art", "Flight Data Art"), ("Flight-Data-Art", "Flight Data Art"), ("flight data art.", "Flight Data Art"), ("flightdataart", "Flight Data Art"),
    ("future shopping!", "Future Shopping"), ("FUTURE   SHOPPING", "Future Shopping"),
    ("welcome reel 2024", "Welcome Reel 2024"), ("welcome reel 2025", "Welcome Reel 2025"), ("welcome reel 2026", None), ("welcome reel", None),
    ("tusker 86 intro", "Tusker_86 Intro"), ("tusker_86 intro", "Tusker_86 Intro"),
    ("brand film cut 3", "Brand — Film: Cut #3"), ("ai ml showcase", "AI/ML Showcase"), ("ai/ml showcase", "AI/ML Showcase"),
    ("50 percent off sale", None), ("50% off sale", "50% Off Sale!"),
    ("welcome", None), ("shopping", "Future Shopping"), ("mountain flows", None),
    ("the-white-tusker-port-folio", "The White Tusker PORT-FOLIO"), ("wt logo reveal", "WT_Logo_Reveal.mp4"), ("hms pitch", "HMS_Pitch.pdf"),
    ("travis review", "Travis Review.pptx"), ("canvas print", "canvas print.png"),
]


class KeyTests(unittest.TestCase):
    def test_only_letters_and_digits_count(self):
        for a, b in (("PORT-FOLIO", "portfolio"), ("Dr. Who's", "dr whos"), ("Q&A", "q and a"), ("Café", "cafe"), ("a  b", "A-B"), ("tusker_86", "tusker 86")):
            with self.subTest(a=a, b=b):
                self.assertTrue(same(a, b))

    def test_a_different_letter_or_number_is_a_different_name(self):
        for a, b in (("tusker 86", "tusker 27"), ("reel 2024", "reel 2025"), ("mountain flow", "mountain flows"), ("lobby", "lobby loop")):
            with self.subTest(a=a, b=b):
                self.assertFalse(same(a, b))

    def test_nothing_is_not_a_name(self):
        self.assertFalse(same("", ""))
        self.assertFalse(same("!!!", "---"))
        self.assertIsNone(resolve("", TITLES))


class ResolveTests(unittest.TestCase):
    def test_every_way_of_saying_a_title_finds_exactly_that_title_or_nothing(self):
        for said, want in SAID:
            with self.subTest(said=said):
                self.assertEqual(resolve(said, TITLES), want)

    def test_two_possible_titles_is_no_answer(self):
        self.assertIsNone(resolve("welcome reel", ["Welcome Reel 2024", "Welcome Reel 2025"]))


class TitleMatchTests(unittest.TestCase):
    def test_a_title_differing_only_in_punctuation_scores_full(self):
        for said, title in (("white tusker portfolio", "The White Tusker PORT-FOLIO"), ("dr whos demo v2", "Dr. Who's Demo (v2)"), ("cafe menu", "Café Menu")):
            with self.subTest(said=said):
                self.assertEqual(title_match.score(said, title), 1.0)

    def test_a_different_number_still_scores_nothing(self):
        self.assertEqual(title_match.score("welcome reel 2026", "Welcome Reel 2025"), 0.0)


class PushTests(unittest.TestCase):
    """The exact real title is what the CMS receives, however it was said."""

    def setUp(self):
        a = self.a = _agent()
        a._pending = None
        a._confirm = None
        a.pushed = []

        async def titles():
            return TITLES[:8], ["Lobby Loop", "Product Launch"]

        async def call_tool(name, args):
            real = TITLES[:8] if args["action"] == "assign_experience" else ["Lobby Loop", "Product Launch"]
            if args["content"] in real:
                a.pushed.append(args)
                return True, f"Showing {args['content']} on {args['screen']}."
            return False, f'I couldn\'t find exactly one experience matching "{args["content"]}". Which one did you mean?'

        a._content_titles = titles
        a._call_tool = call_tool

    def push(self, said):
        return asyncio.run(self.a._assign_content({"action": "assign_content", "content": said, "screen": "tusker 86"}))

    def test_variants_are_sent_as_the_exact_title(self):
        for said, title in (("portfolio", "The White Tusker PORT-FOLIO"), ("dr whos demo v 2", "Dr. Who's Demo (v2)"), ("q and a session", "Q&A Session"),
                            ("cafe menu", "Café Menu"), ("lobby loop", "Lobby Loop"), ("LOBBY-LOOP", "Lobby Loop")):
            with self.subTest(said=said):
                self.a.pushed.clear()
                ok, _ = self.push(said)
                self.assertTrue(ok)
                self.assertEqual(self.a.pushed[0]["content"], title)

    def test_an_ambiguous_title_is_not_guessed(self):
        ok, _ = self.push("welcome reel")
        self.assertFalse(ok)
        self.assertEqual(self.a.pushed, [])


class PortfolioOfferTests(unittest.TestCase):
    def find(self, title, screen="tusker 86", playing=None):
        a = _agent()
        a._portfolio_skip_until = 0.0
        screens = [{"screenName": screen, "blanked": False, "experienceName": playing}]
        with mock.patch("agent.planning.load_api_config", lambda: {"portfolio_offer": True}), \
                mock.patch("agent.planning.cms_client.list_experiences", lambda: [{"title": title}, {"title": "Welcome Screen"}]), \
                mock.patch("agent.planning.cms_client.list_screens", lambda: screens):
            return asyncio.run(a._find_portfolio())

    def test_any_spelling_of_portfolio_in_the_title_is_found(self):
        for title in ("The White Tusker PORT-FOLIO", "White Tusker Portfolio", "PORT FOLIO", "Portfolio!", "White Tusker's Port_folio (2026)", "portfolio"):
            with self.subTest(title=title):
                self.assertEqual(self.find(title), (title, "tusker 86"))

    def test_the_main_screen_is_found_however_it_is_written(self):
        for screen in ("tusker 86", "Tusker-86", "TUSKER 86", "tusker_86"):
            with self.subTest(screen=screen):
                self.assertIsNotNone(self.find("White Tusker Portfolio", screen=screen))

    def test_already_playing_is_recognised_whatever_the_punctuation(self):
        self.assertIsNone(self.find("The White Tusker PORT-FOLIO", playing="the white tusker port folio"))


if __name__ == "__main__":
    unittest.main()
