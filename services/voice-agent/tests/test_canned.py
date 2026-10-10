"""Written-down FAQ and small-talk answers: matching (nlu/canned.py), the route in the conversation (agent/canned_route.py), pre-rendered audio."""

import asyncio
import hashlib
import json
import random
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from agent.audio_cache import AudioCache, cache_key  # noqa: E402
from nlu.canned import ACTION_WORDS, CannedMatcher, Entry, load_entries, pick_answer  # noqa: E402
from tests.test_planner import _planned, _say  # noqa: E402

FAQ_PATH = AGENT_ROOT / "knowledge" / "faq.yaml"
SMALLTALK_PATH = AGENT_ROOT / "knowledge" / "smalltalk.yaml"
CONTACT = "You can reach us at hello at thewhitetusker dot com."


def fake_embed(texts):
    """A stand-in for nomic-embed-text: words hashed into 128 dimensions, so sentences that share words are close."""
    out = np.zeros((len(texts), 128), dtype=np.float32)
    for i, t in enumerate(texts):
        for w in re.findall(r"[a-z0-9']+", t.lower()):
            out[i, int(hashlib.md5(w.encode()).hexdigest(), 16) % 128] += 1.0
        n = np.linalg.norm(out[i])
        out[i] /= n or 1.0
    return out


def entry(id, variants, answer, kind="faq", topic="company", qtype=(), **kw):
    return Entry(id=id, kind=kind, topic=topic, variants=list(variants), answers=[answer] if isinstance(answer, str) else list(answer),
                 question_type=list(qtype), status="approved", **kw)


ENTRIES = [
    entry("founders", ["Who founded White Tusker", "Who are the founders of White Tusker", "Who started White Tusker"],
          "White Tusker was founded by Smriti Attavar, Naveen DC and Varun Parikh.", qtype=["who"], sources=["the_white_tusker.md: Founders and leadership"]),
    entry("ni_founding_year", ["When was White Tusker founded", "In which year was White Tusker founded", "When did White Tusker start"],
          "I don't have that detail. I can tell you about our founders if you like.", kind="no_info", qtype=["when"]),
    entry("location", ["Where is White Tusker based", "Where is your studio", "Where are you located"], "Our studio is in Indiranagar, Bengaluru, India.",
          qtype=["where"], add_email_line=True, sources=["the_white_tusker.md: Where and how to reach us"]),
    entry("overview", ["What is White Tusker", "Tell me about White Tusker", "Tell me about your company"], "White Tusker is a brand experience design studio.",
          qtype=["what"], sources=["the_white_tusker.md: Who we are"]),
    entry("thanks", ["Thank you", "Thanks a lot", "Thank you so much"], ["You're welcome.", "Happy to help."], kind="smalltalk", topic="smalltalk", intent="thanks"),
    entry("joke", ["Tell me a joke", "Say something funny", "Do you know any jokes"], ["Joke one.", "Joke two.", "Joke three."], kind="smalltalk", topic="smalltalk", intent="joke"),
]


def matcher(entries=None, **kw):
    kw.setdefault("threshold", 0.7)  # the fake embedder's scale; the real thresholds were measured with the real model
    return CannedMatcher(list(entries or ENTRIES), fake_embed, **kw)


class MatchTests(unittest.TestCase):
    def test_a_reworded_question_finds_its_entry(self):
        for text, want in (("Who founded White Tusker", "founders"), ("who are the founders", "founders"), ("Where is your studio located", "location")):
            with self.subTest(text=text):
                m = matcher().match(text)
                self.assertIsNotNone(m, text)
                self.assertEqual(m.entry.id, want)

    def test_nothing_close_matches_nothing(self):
        for text in ("What is the weather in Paris", "banana", "who won the cricket match yesterday", ""):
            with self.subTest(text=text):
                self.assertIsNone(matcher().match(text))

    def test_the_question_word_rule_when_was_it_founded_never_gets_the_founders_answer(self):
        m = matcher().match("When was White Tusker founded")
        self.assertEqual(m.entry.id, "ni_founding_year")
        self.assertIn("I don't have that detail", m.entry.answers[0])
        without = [e for e in ENTRIES if e.id != "ni_founding_year"]  # even with that entry gone, "founders" must not answer a "when"
        m2 = matcher(without).match("When was White Tusker founded")
        self.assertTrue(m2 is None or m2.entry.id != "founders")

    def test_who_still_gets_the_founders_answer_and_not_the_no_info_one(self):
        self.assertEqual(matcher().match("Who founded White Tusker").entry.id, "founders")

    def test_a_command_is_never_taken_for_a_question(self):
        m = matcher()
        for text in ("Turn on the cove light", "Set the AC to 22", "Show the company presentation", "Play the welcome video", "Stop the main screen",
                     "Lock the door", "Increase the brightness", "Mute the volume", "Open the presentation", "Switch off the lights", "Start the demo",
                     "close the door", "decrease the volume", "Unlock the door"):
            with self.subTest(text=text):
                self.assertIsNone(m.match(text))

    def test_an_action_word_blocks_even_a_perfect_match(self):
        e = entry("x", ["Turn on the cove light please"], "No.")
        self.assertIsNone(matcher([e]).match("Turn on the cove light please"))

    def test_a_device_name_blocks_a_match(self):
        e = entry("cove", ["Tell me about the cove light"], "It is a light.")
        m = matcher([e])
        self.assertIsNotNone(m.match("Tell me about the cove light"))
        self.assertIsNone(m.match("Tell me about the cove light", device_words=["cove light"]))

    def test_a_close_second_entry_means_no_answer(self):
        a = entry("a", ["Tell me about your projects"], "A.")
        b = entry("b", ["Tell me about your projects", "Tell us about your projects"], "B.")  # the same words in two entries: no clear winner
        self.assertIsNone(matcher([a, b]).match("Tell me about your projects"))

    def test_it_needs_the_threshold(self):
        self.assertIsNotNone(matcher(threshold=0.5).match("Who founded"))
        self.assertIsNone(matcher(threshold=0.999).match("Who founded the White Tusker studio"))

    def test_the_index_is_cached_by_content(self):
        calls = []

        def counting(texts):
            calls.append(len(texts))
            return fake_embed(texts)

        with tempfile.TemporaryDirectory() as d:
            cache = Path(d) / "idx.npz"
            CannedMatcher(ENTRIES, counting, cache_path=cache)
            CannedMatcher(ENTRIES, counting, cache_path=cache)
            self.assertEqual(calls, [sum(len(e.variants) for e in ENTRIES)])  # embedded once
            changed = [*ENTRIES, entry("new", ["Brand new question here"], "New.")]
            CannedMatcher(changed, counting, cache_path=cache)
            self.assertEqual(len(calls), 2)


class LoadTests(unittest.TestCase):
    def test_only_approved_entries_are_used_by_default(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "faq.yaml"
            p.write_text(
                "entries:\n  - {id: a, topic: company, variants: [Who founded it], answer: A., status: approved}\n"
                "  - {id: b, topic: company, variants: [Who runs it], answer: B., status: draft}\n"
                "no_info:\n  - {id: c, topic: company, variants: [How much], answer: C., status: approved}\n", encoding="utf-8")
            self.assertEqual([e.id for e in load_entries(p)], ["a", "c"])
            self.assertEqual({e.id for e in load_entries(p, statuses=("draft", "approved"))}, {"a", "b", "c"})
            self.assertEqual([e.kind for e in load_entries(p)], ["faq", "no_info"])

    def test_a_missing_file_is_no_entries(self):
        self.assertEqual(load_entries(Path("nope.yaml"), Path("nope2.yaml")), [])

    def test_the_real_files_load_and_every_entry_is_well_formed(self):
        entries = load_entries(FAQ_PATH, SMALLTALK_PATH, statuses=("draft", "approved"))
        self.assertGreater(len(entries), 30)
        ids = [e.id for e in entries]
        self.assertEqual(len(ids), len(set(ids)))
        for e in entries:
            with self.subTest(id=e.id):
                self.assertTrue(e.variants and e.answers)
                for a in e.answers:
                    self.assertNotRegex(a, r"The White Tusker")
                    self.assertNotRegex(a, r"@|https?://|www\.|\.com")  # contact details are added by code
        self.assertIn("ni_founding_year", ids)  # "When was White Tusker founded" has an honest entry

    def test_every_variant_of_the_real_files_avoids_action_words(self):
        for e in load_entries(FAQ_PATH, SMALLTALK_PATH, statuses=("draft", "approved")):
            for v in e.variants:
                with self.subTest(id=e.id, v=v):
                    self.assertFalse(set(re.findall(r"[a-z']+", v.lower())) & ACTION_WORDS)


class AnswerPickingTests(unittest.TestCase):
    def test_jokes_do_not_repeat_until_all_are_told(self):
        j = next(e for e in ENTRIES if e.id == "joke")
        last, used = {}, set()
        told = [pick_answer(j, last, used, random.Random(i)) for i in range(3)]
        self.assertEqual(sorted(told), ["Joke one.", "Joke three.", "Joke two."])
        self.assertIn(pick_answer(j, last, used, random.Random(9)), told)  # all told: the cycle starts again

    def test_an_answer_is_not_repeated_back_to_back(self):
        t = next(e for e in ENTRIES if e.id == "thanks")
        last, prev = {}, None
        for i in range(12):
            a = pick_answer(t, last, set(), random.Random(i))
            self.assertNotEqual(a, prev)
            prev = a


class RouteTests(unittest.TestCase):
    """The route in the conversation, with the planner scripted so we can see when it is (not) reached."""

    def agent(self, entries=None, planner_answers=(), cache=None):
        a = _planned("x", *planner_answers)
        a._canned_matcher = matcher(entries)
        a._canned_tried, a._canned_last, a._jokes_used = True, {}, set()
        a._audio_cache = cache
        a._history, a._history_at = [], 0.0
        patcher = mock.patch("agent.canned_route.retriever.sections", lambda groups=None: [
            {"chunk_id": "wt#1", "label": "White Tusker: Founders and leadership", "topic": "our founders", "group": "company"},
            {"chunk_id": "wt#0", "label": "White Tusker: Who we are", "topic": "who we are", "group": "company"},
            {"chunk_id": "wt#3", "label": "White Tusker: Where and how to reach us", "topic": "where we are", "group": "company"}])
        patcher.start()
        self.addCleanup(patcher.stop)
        return a

    def test_a_written_answer_is_spoken_without_the_planner_or_the_model(self):
        a = self.agent()
        _say(a, "who founded white tusker")
        self.assertEqual(" ".join(a.said), "White Tusker was founded by Smriti Attavar, Naveen DC and Varun Parikh.")
        self.assertEqual(a.chat.requests, [])
        self.assertEqual(a._path, "faq")

    def test_the_email_line_is_added_by_code_when_the_entry_asks_for_it(self):
        a = self.agent()
        _say(a, "where is your studio")
        self.assertEqual(" ".join(a.said), f"Our studio is in Indiranagar, Bengaluru, India. {CONTACT}")

    def test_a_no_info_entry_says_so_and_offers_a_real_topic(self):
        a = self.agent()
        _say(a, "when was white tusker founded")
        self.assertTrue(" ".join(a.said).startswith("I don't have that detail."))
        self.assertEqual(a._path, "faq (no info)")

    def test_small_talk_is_answered_and_remembered(self):
        a = self.agent()
        _say(a, "thank you so much")
        self.assertIn(" ".join(a.said), ("You're welcome.", "Happy to help."))
        self.assertEqual(a._path, "small talk")
        self.assertEqual([m["role"] for m in a._recent_history()], ["user", "assistant"])

    def test_jokes_rotate_in_a_session(self):
        a = self.agent()
        told = []
        for _ in range(3):
            a.said.clear()
            _say(a, "tell me a joke")
            told.append(" ".join(a.said))
        self.assertEqual(sorted(told), ["Joke one.", "Joke three.", "Joke two."])

    def test_a_faq_answer_marks_its_sections_used_so_tell_me_more_continues(self):
        a = self.agent()
        _say(a, "who founded white tusker")
        self.assertIn("wt#1", a._kb_used)
        self.assertTrue(a._has_previous_answer())
        self.assertEqual((a._kb_last_topic, a._company_answers, a._kb_company_said), ("company", 1, True))

    def test_small_talk_and_no_info_do_not_count_as_something_to_continue(self):
        a = self.agent()
        _say(a, "thank you")
        self.assertFalse(a._has_previous_answer())
        a2 = self.agent()
        _say(a2, "when was white tusker founded")
        self.assertFalse(a2._has_previous_answer())

    def test_no_match_goes_on_to_the_planner(self):
        a = self.agent(planner_answers=[json.dumps({"kind": "other", "actions": []})])

        async def llm(command):
            a.said.append("model")
            return "model"

        a._run_llm = llm
        _say(a, "what is the weather in paris")
        self.assertEqual(len(a.chat.requests), 1)

    def test_a_device_command_is_never_caught_by_this_route(self):
        plan = json.dumps({"kind": "actions", "actions": [{"quote": "turn on the cove light", "op": "light_on", "target": {
            "words": "the cove light", "type": "light", "scope": "specific", "name": "tusker edge"}, "parameters": {}}]})
        a = self.agent(planner_answers=[plan])
        _say(a, "turn on the cove light")
        self.assertTrue(a.calls and a.calls[0][0] == "device_control")
        self.assertNotIn(a._path, ("faq", "small talk"))

    def test_the_first_company_answer_carries_the_portfolio_offer(self):
        a = self.agent()
        config = {"portfolio_offer": True}
        with mock.patch("agent.planning.load_api_config", lambda: config), \
                mock.patch("agent.planning.cms_client.list_screens", lambda: [{"screenName": "tusker 86", "blanked": False, "experienceName": None}]), \
                mock.patch("agent.planning.cms_client.list_experiences", lambda: [{"title": "White Tusker Portfolio"}]):
            a._portfolio_skip_until = 0.0
            _say(a, "who founded white tusker")
            self.assertIn("Would you like me to play our portfolio on the main screen?", " ".join(a.said))
            self.assertTrue(a._confirm.offer)

    def test_pre_rendered_audio_is_played_instead_of_speaking_the_text(self):
        with tempfile.TemporaryDirectory() as d:
            cache = AudioCache(Path(d), "voice1", "model1", 24000)
            text = "White Tusker was founded by Smriti Attavar, Naveen DC and Varun Parikh."
            pcm = bytes(range(256)) * 100
            cache.store(text, pcm)
            a = self.agent(cache=cache)
            a.audio_in_queue = asyncio.Queue()
            spoken = []

            async def say(t):
                spoken.append(t)

            a._say = say
            _say(a, "who founded white tusker")
            self.assertEqual(spoken, [])  # not synthesised again
            queued = b""
            while not a.audio_in_queue.empty():
                queued += a.audio_in_queue.get_nowait()
            self.assertEqual(queued, pcm)

    def test_without_rendered_audio_it_falls_back_to_normal_speech(self):
        with tempfile.TemporaryDirectory() as d:
            a = self.agent(cache=AudioCache(Path(d), "voice1", "model1", 24000))
            a.audio_in_queue = asyncio.Queue()
            _say(a, "who founded white tusker")
            self.assertTrue(a.said)
            self.assertTrue(a.audio_in_queue.empty())

    def test_a_failing_matcher_never_breaks_the_conversation(self):
        a = self.agent(planner_answers=[json.dumps({"kind": "other", "actions": []})])
        a._canned_matcher.match = mock.Mock(side_effect=OSError("Ollama is down"))

        async def llm(command):
            a.said.append("model")
            return "model"

        a._run_llm = llm
        _say(a, "who founded white tusker")
        self.assertEqual(a.said, ["model"])


class AudioCacheTests(unittest.TestCase):
    def test_the_key_changes_with_text_voice_model_and_rate(self):
        base = cache_key("Hello there.", "v1", "m1", 24000)
        self.assertEqual(base, cache_key("Hello   there.", "v1", "m1", 24000))  # spacing does not matter
        for other in (cache_key("Hello there!", "v1", "m1", 24000), cache_key("Hello there.", "v2", "m1", 24000),
                      cache_key("Hello there.", "v1", "m2", 24000), cache_key("Hello there.", "v1", "m1", 16000)):
            self.assertNotEqual(base, other)

    def test_store_and_load_round_trip_and_an_odd_or_empty_file_is_not_used(self):
        with tempfile.TemporaryDirectory() as d:
            c = AudioCache(Path(d), "v", "m", 24000)
            self.assertIsNone(c.load("x"))
            c.store("x", b"\x01\x00\x02\x00")
            self.assertEqual(c.load("x"), b"\x01\x00\x02\x00")
            c.path("odd").write_bytes(b"\x01\x00\x02")
            self.assertIsNone(c.load("odd"))
            c.path("empty").write_bytes(b"")
            self.assertFalse(c.has("empty"))


class FollowUpWindowTests(unittest.TestCase):
    def test_a_reply_that_asks_something_wants_a_follow_up(self):
        a = _planned("x")
        with mock.patch("agent.commands.load_api_config", lambda: {"followup_window_sec": 8}):
            self.assertTrue(a._expects_answer("Which light do you mean? Say Hey Travis, then your answer."))
            self.assertFalse(a._expects_answer("Done: cove light."))
            a._pending = object()
            self.assertTrue(a._expects_answer("Done."))

    def test_a_fresh_offer_wants_a_follow_up(self):
        from nlu import title_match

        a = _planned("x")
        a._confirm = title_match.Confirm([title_match.Candidate("experience", "P", 1.0, "screen_control", {})], "portfolio", offer=True)
        with mock.patch("agent.commands.load_api_config", lambda: {"followup_window_sec": 8}):
            self.assertTrue(a._expects_answer("Would you like me to play our portfolio?"))

    def test_the_window_can_be_switched_off(self):
        a = _planned("x")
        with mock.patch("agent.commands.load_api_config", lambda: {"followup_window_sec": 0}):
            self.assertFalse(a._expects_answer("Which light do you mean?"))

    def test_the_flag_is_set_before_the_reply_is_complete(self):
        """The mic callback decides the moment _reply_complete_at is set, so the flag has to be there already."""
        a = _planned("x", json.dumps({"kind": "clarify", "actions": [], "question": "Which light did you mean?"}))
        seen = {}
        real = a._finish_reply

        async def finish():
            seen["flag"] = a._followup_wanted
            await real()

        a._finish_reply = finish
        with mock.patch("agent.commands.load_api_config", lambda: {"followup_window_sec": 8}):
            _say(a, "mmm the thing")
        self.assertTrue(seen["flag"])


class RenderToolTests(unittest.TestCase):
    """tools/render_audio.py: which texts get rendered (offline: no ElevenLabs call here)."""

    def test_the_texts_are_exactly_what_the_agent_looks_up(self):
        from agent.vocabulary import speakable
        from nlu.spoken_names import say_names
        from tools.render_audio import texts_to_render

        with tempfile.TemporaryDirectory() as d:
            faq = Path(d) / "faq.yaml"
            faq.write_text(
                "entries:\n  - {id: a, topic: company, variants: [Where are you], answer: 'Our studio is in Bengaluru.', add_email_line: true, status: approved}\n"
                "  - {id: b, topic: company, variants: [Who runs it], answer: 'The cove light is on.', status: draft}\n", encoding="utf-8")
            cfg = {"faq_path": str(faq), "smalltalk_path": str(Path(d) / "none.yaml"), "company_contact_line": CONTACT}
            self.assertEqual(texts_to_render(("approved",), cfg), [f"Our studio is in Bengaluru. {CONTACT}"])
            both = texts_to_render(("approved", "draft"), cfg)
            self.assertEqual(len(both), 2)
            self.assertEqual(both[1], say_names(speakable("The cove light is on.")))

    def test_it_never_renders_when_the_quota_share_is_too_high_without_force(self):
        from tools import render_audio

        with mock.patch.object(render_audio, "texts_to_render", lambda s, c: ["x" * 500]), \
                mock.patch.object(render_audio, "quota", lambda k: (9000, 10000)), \
                mock.patch.object(render_audio, "render_one", side_effect=AssertionError("rendered")), \
                mock.patch.object(render_audio, "load_api_config", lambda: {"elevenlabs_api_key": "k", "elevenlabs_voice_id": "v", "tts_cache_dir": tempfile.mkdtemp()}), \
                mock.patch.object(sys, "argv", ["render_audio", "--render"]):
            self.assertEqual(render_audio.main(), 4)  # 500 of 1000 left = 50%: refused

    def test_check_only_renders_nothing(self):
        from tools import render_audio

        with mock.patch.object(render_audio, "texts_to_render", lambda s, c: ["hello there."]), \
                mock.patch.object(render_audio, "quota", lambda k: (0, 10000)), \
                mock.patch.object(render_audio, "render_one", side_effect=AssertionError("rendered")), \
                mock.patch.object(render_audio, "load_api_config", lambda: {"elevenlabs_api_key": "k", "elevenlabs_voice_id": "v", "tts_cache_dir": tempfile.mkdtemp()}), \
                mock.patch.object(sys, "argv", ["render_audio"]):
            self.assertEqual(render_audio.main(), 0)


if __name__ == "__main__":
    unittest.main()
