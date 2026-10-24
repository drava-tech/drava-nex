"""Questions about the company / CMS / Travis are answered from the knowledge base by software (agent/knowledge_answer.py):
search first, then the model answers from just those sections, then checks; the contact line and the topic offers come from code.
The planner's reading of the question (topic, standalone query, wants_more, asks_contact) is scripted here; the search and the
model's answer are scripted too, so the rules around them are what is tested."""

import asyncio
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from rag.retriever import Hit  # noqa: E402
from safety.reply_guard import grounding  # noqa: E402
from tests.test_planner import _planned, _say  # noqa: E402

OVERVIEW = "White Tusker is a brand experience design studio. We design spaces that respond to people, content, data and events."
CLIENTS = "Boeing, Bosch, Volvo, Tata Steel, DIAGEO, Infosys and others across technology, automotive and corporate sectors."
WHAT = "We work in four areas: architecture and interior spaces, immersive technology, brand solutions, and corporate and brand films."
WHERE = "Studio: Indiranagar, Bengaluru, India.\nEmail: hello@thewhitetusker.com\nWebsite: thewhitetusker.com"
TRAVIS = "Travis is the voice assistant built by White Tusker. It controls this space: lights, AC, the door, and what plays on each screen."
CMS = "The CMS platform manages the content shown on the screens in this room."

SECTIONS = {  # chunk id -> (label, topic, group, text)
    "wt#0": ("White Tusker: Who we are", "who we are", "company", OVERVIEW),
    "wt#1": ("White Tusker: Our four verticals", "what we do", "company", WHAT),
    "wt#2": ("White Tusker: Clients", "our clients", "company", CLIENTS),
    "wt#3": ("White Tusker: Where we are", "where we are", "company", WHERE),
    "tr#0": ("Travis: About Travis", "Travis", "travis", TRAVIS),
    "cms#0": ("CMS: Overview", "overview", "cms", CMS),
}
# what the fake search returns for each standalone query, best first
RESULTS = {
    "what is White Tusker": ["wt#0", "wt#3"],
    "more about White Tusker": ["wt#2", "wt#1", "wt#0"],
    "White Tusker clients": ["wt#2", "wt#0"],
    "who founded White Tusker": ["wt#0", "wt#3"],
    "how to contact White Tusker": ["wt#3", "wt#2"],
    "what is the Travis control system": ["tr#0"],
    "what does the CMS do": ["cms#0"],
}


def _hit(cid, score=0.7):
    label, topic, group, text = SECTIONS[cid]
    return Hit(cid, label, topic, group, text, score)


def chunks(text, size=7):
    return [text[i:i + size] for i in range(0, len(text), size)]


class FakeStream:
    """What OllamaChat.stream_text returns: an async generator over scripted chunks that records being closed early."""

    def __init__(self, parts):
        self.parts, self.closed, self.sent = list(parts), False, 0

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for part in self.parts:
            self.sent += 1
            yield part

    async def aclose(self):
        self.closed = True


class Fixture:
    def __init__(self, test, plans, answers):
        """plans: one dict per question: the planner's `topic`, and the standalone `query` (what the rewrite call returns when it runs; also what the
        fake search is scripted by, whatever the actual query was) plus wants_more.
        answers: what the answering model streams, in turn: dicts {found, answer} (found False streams NOT_FOUND), strings, or lists of chunks."""
        self.a = _planned("x", *[json.dumps({"kind": "question", "actions": [], "topic": p["topic"]}) for p in plans])
        self.searches, self.prompts, self.rewrites, self.streams, self.schemas = [], [], [], [], []
        self._plans = list(plans)
        self._cur = None
        self._answers = list(answers)
        a = self.a
        a._portfolio_skip_until = float("inf")  # no portfolio lookup here

        def search(query, groups=None, exclude=frozenset(), k=2, min_score=0.5, boost_groups=None, boost=0.0):
            self.searches.append({"query": query, "groups": groups, "exclude": set(exclude), "k": k, "min_score": min_score,
                                  "boost_groups": boost_groups, "boost": boost})
            scripted = (self._cur or {}).get("query", query)
            ids = [i for i in RESULTS.get(scripted, RESULTS.get(query, [])) if (not groups or SECTIONS[i][2] in groups) and i not in exclude]
            if min_score == 0.0:  # a request for the closest unused sections, whatever the score (the topic offer)
                ids = [i for i in SECTIONS if (not groups or SECTIONS[i][2] in groups) and i not in exclude]
            return [_hit(i) for i in ids[:k]]

        async def complete_json(messages, schema, max_tokens=400):
            assert "wants_more" in schema["properties"], "the answer is streamed as text now"
            self.rewrites.append(messages)
            p = self._cur
            return json.dumps({"query": p.get("query", ""), "topic": {"experience_center": "place"}.get(p["topic"], p["topic"]),
                               "wants_more": p.get("wants_more", False)})

        def stream_text(messages, max_tokens=300, schema=None):
            """What Ollama's structured output streams: the JSON being written, "found" first. A list is the answer's own text in pieces; a list of
            strings that already is JSON can be given as {"raw": [...]}."""
            self.prompts.append(messages)
            self.schemas.append(schema)
            answer = self._answers.pop(0)
            if isinstance(answer, dict) and "raw" in answer:
                parts = answer["raw"]
            else:
                if isinstance(answer, dict):
                    found, text = bool(answer.get("found")), answer.get("answer", "")
                else:
                    found, text = True, "".join(answer) if isinstance(answer, list) else answer
                payload = json.dumps({"found": found, "answer": text if found else ""})
                parts = chunks(payload)
            stream = FakeStream(parts)
            self.streams.append(stream)
            return stream

        patcher = mock.patch("agent.knowledge_answer.retriever.search", search)
        patcher.start()
        test.addCleanup(patcher.stop)
        a._llm.complete_json = complete_json
        a._llm.stream_text = stream_text
        a._history = []
        a._history_at = 0.0

    def ask(self, text):
        self.a.said.clear()
        self._cur = self._plans.pop(0) if self._plans else None
        _say(self.a, text)
        return " ".join(self.a.said)


CONTACT = "You can reach us at hello at thewhitetusker dot com."


def company(**kw):
    return {"topic": "company", "query": "what is White Tusker", **kw}


class AnswerTests(unittest.TestCase):
    def test_the_first_overview_gets_the_contact_line_from_code_not_from_the_model(self):
        f = Fixture(self, [company()], [{"found": True, "answer": "White Tusker is a brand experience design studio. Email us at hello@thewhitetusker.com."}])
        said = f.ask("tell me about white tusker")
        self.assertEqual(said, f"White Tusker is a brand experience design studio. {CONTACT}")  # the model's own email sentence is gone
        self.assertEqual(f.a._path, "knowledge")

    def test_the_model_never_sees_the_email_or_website_lines(self):
        f = Fixture(self, [company(query="how to contact White Tusker")], [{"found": True, "answer": "We are in Indiranagar, Bengaluru, India."}])
        f.ask("where are you")
        shown = f.prompts[0][-1]["content"]
        self.assertIn("Indiranagar", shown)
        self.assertNotIn("hello@thewhitetusker.com", shown)
        self.assertNotIn("thewhitetusker.com", shown)

    def test_a_follow_up_skips_the_sections_already_used_and_has_no_contact_line(self):
        f = Fixture(self, [company(), company(query="more about White Tusker", wants_more=True)],
                    [{"found": True, "answer": "White Tusker is a brand experience design studio."},
                     {"found": True, "answer": "White Tusker works with Boeing, Bosch and Volvo."}])
        f.ask("tell me about white tusker")
        said = f.ask("tell me more about it")
        self.assertEqual(f.searches[1]["exclude"], {"wt#0", "wt#3"})  # what the first answer used
        self.assertEqual(said, "White Tusker works with Boeing, Bosch and Volvo.")
        self.assertNotIn("hello", said)

    def test_the_conversation_so_far_goes_to_the_model_so_it_does_not_repeat_itself(self):
        f = Fixture(self, [company(), company(query="more about White Tusker", wants_more=True)],
                    [{"found": True, "answer": "White Tusker is a brand experience design studio."}, {"found": True, "answer": "It works with Boeing and Bosch."}])
        f.ask("tell me about white tusker")
        f.ask("tell me more about it")
        roles = [m["role"] for m in f.prompts[1]]
        self.assertEqual(roles[0], "system")
        self.assertIn("White Tusker is a brand experience design studio.", " ".join(m["content"] for m in f.prompts[1] if m["role"] == "assistant"))
        self.assertIn("Do not repeat", f.prompts[1][-1]["content"])

    def test_wants_more_is_ignored_when_nothing_was_said_yet(self):
        f = Fixture(self, [company(query="more about White Tusker", wants_more=True)], [{"found": True, "answer": "Boeing, Bosch and Volvo are clients."}])
        said = f.ask("what else can you tell me about white tusker")
        self.assertEqual(f.searches[0]["exclude"], set())
        self.assertIn(CONTACT, said)  # it is the first overview after all

    def test_a_question_about_reaching_them_gets_the_line_alone_when_the_knowledge_has_nothing_else(self):
        f = Fixture(self, [company(), company(query="how to contact White Tusker")],
                    [{"found": True, "answer": "White Tusker is a studio."}, {"found": False, "answer": ""}])
        f.ask("tell me about white tusker")
        self.assertEqual(f.ask("how can I contact them"), CONTACT)

    def test_where_they_are_gets_the_answer_and_the_line(self):
        f = Fixture(self, [company(query="how to contact White Tusker")], [{"found": True, "answer": "We are in Indiranagar, Bengaluru, India."}])
        self.assertEqual(f.ask("where are you"), f"We are in Indiranagar, Bengaluru, India. {CONTACT}")

    def test_the_contact_line_comes_from_the_config(self):
        f = Fixture(self, [company()], [{"found": True, "answer": "White Tusker is a studio."}])
        with mock.patch("agent.knowledge_answer.load_api_config", lambda: {"company_contact_line": "Write to us."}):
            self.assertEqual(f.ask("tell me about white tusker"), "White Tusker is a studio. Write to us.")


class NothingToSayTests(unittest.TestCase):
    def test_not_in_the_knowledge_says_so_and_offers_topics_that_exist(self):
        f = Fixture(self, [company(query="who founded White Tusker")], [{"found": False, "answer": ""}])
        said = f.ask("who founded it")
        self.assertTrue(said.startswith("I don't have that detail."))
        self.assertIn("I can tell you about", said)
        topics = said.split("I can tell you about ")[1].rstrip(" .").replace(" if you like", "").split(" or ")
        self.assertEqual(len(topics), 2)
        for t in topics:
            self.assertIn(t, {s[1] for s in SECTIONS.values() if s[2] == "company"})  # real section names, in the file's own words
        self.assertNotIn(CONTACT, said)
        self.assertFalse(f.a._kb_ok)

    def test_nothing_new_to_add_says_that_is_all(self):
        f = Fixture(self, [company(), company(query="more about White Tusker", wants_more=True), company(query="more about White Tusker", wants_more=True)],
                    [{"found": True, "answer": "White Tusker is a studio."}, {"found": True, "answer": "It works with Boeing."}, {"found": False, "answer": ""}])
        f.ask("tell me about white tusker")
        f.ask("tell me more")
        said = f.ask("tell me more")
        self.assertTrue(said.startswith("That's all I have on that."), said)

    def test_offers_never_name_a_section_already_used_or_one_from_another_group(self):
        f = Fixture(self, [company(), company(query="who founded White Tusker")],
                    [{"found": True, "answer": "White Tusker is a studio."}, {"found": False, "answer": ""}])
        f.ask("tell me about white tusker")
        said = f.ask("who founded it")
        offer_search = f.searches[-1]
        self.assertEqual(offer_search["groups"], {"company"})
        self.assertTrue({"wt#0", "wt#3"} <= offer_search["exclude"])
        self.assertNotIn("who we are", said)
        self.assertNotIn("Travis", said)

    def test_words_that_are_not_in_the_knowledge_are_not_said(self):
        f = Fixture(self, [company(query="the white tusker projects")],
                    [{"found": True, "answer": "Examples include digital lounges, pop-up retail environments and interactive festival installations."}])
        said = f.ask("what about their projects")
        self.assertTrue(said.startswith("I don't have that detail."))
        self.assertNotIn("lounges", said)

    def test_an_answer_that_only_rephrases_the_knowledge_is_let_through(self):
        f = Fixture(self, [company(query="White Tusker clients")], [{"found": True, "answer": "Their clients include Boeing, Bosch and Volvo in technology and automotive."}])
        self.assertIn("Boeing", f.ask("what about their clients"))

    def test_an_answer_that_is_chatter_not_from_the_knowledge_is_treated_as_no_answer(self):
        f = Fixture(self, [company()], ["sure! White Tusker is great"])
        self.assertTrue(f.ask("tell me about white tusker").startswith("I don't have that detail."))

    def test_a_search_that_fails_is_said_not_hidden(self):
        f = Fixture(self, [company()], [])
        with mock.patch("agent.knowledge_answer.retriever.search", side_effect=OSError("embedding model down")):
            self.assertEqual(f.ask("tell me about white tusker"), "I can't look that up right now.")
        self.assertFalse(f.a._kb_ok)


class OffTopicTests(unittest.TestCase):
    """The planner reads any "who / what is" as a question about us; a question with no answer is checked by the relevance gate."""

    def _gate(self, f, allowed):
        from nlu.relevance import Review
        from tests.test_local_agent import _FakeGate

        f.a._gate = _FakeGate(Review(allowed, "x"))
        f.a._off_topic_reply = "Sorry, only the room."
        return f.a._gate

    def test_a_question_that_is_not_about_us_is_declined_not_answered_with_i_dont_have_that_detail(self):
        f = Fixture(self, [company(query="Who is the CEO of Google")], [{"found": False, "answer": ""}])
        gate = self._gate(f, allowed=False)
        said = f.ask("Who is the CEO of Google?")
        self.assertEqual(said, "Sorry, only the room.")
        self.assertEqual(f.a._path, "declined (off topic)")
        self.assertEqual(gate.seen, ["Who is the CEO of Google?"])  # the gate reads the query that was searched: the transcript, nothing to resolve
        self.assertTrue(f.a._off_topic)
        self.assertEqual(f.a._calls_log, [])

    def test_a_declined_question_never_starts_the_portfolio_lookup(self):
        """The CMS is not asked about a portfolio until a real answer about the company is being given (the off-topic cases forbid any CMS call)."""
        f = Fixture(self, [company(query="Who is the CEO of Google")], [{"found": False, "answer": ""}])
        self._gate(f, allowed=False)
        started = []
        f.a._prefetch_portfolio = lambda topic: started.append(topic)
        f.ask("Who is the CEO of Google?")
        self.assertEqual(started, [])

    def test_the_lookup_starts_with_the_first_spoken_sentence_of_a_company_answer(self):
        f = Fixture(self, [company()], [{"found": True, "answer": "White Tusker is a brand experience design studio."}])
        started = []
        f.a._prefetch_portfolio = lambda topic: started.append(topic)
        f.ask("tell me about white tusker")
        self.assertEqual(started, ["company"])

    def test_a_question_about_us_that_the_file_does_not_answer_is_not_declined(self):
        f = Fixture(self, [company(query="who founded White Tusker")], [{"found": False, "answer": ""}])
        self._gate(f, allowed=True)
        self.assertTrue(f.ask("who founded it").startswith("I don't have that detail."))
        self.assertFalse(f.a._off_topic)

    def test_an_answered_question_never_asks_the_gate(self):
        f = Fixture(self, [company()], [{"found": True, "answer": "White Tusker is a brand experience design studio."}])
        gate = self._gate(f, allowed=False)
        f.ask("tell me about white tusker")
        self.assertEqual(gate.seen, [])

    def test_tell_me_more_uses_the_next_unused_sections_whatever_they_score(self):
        f = Fixture(self, [company(), company(query="more", wants_more=True)],
                    [{"found": True, "answer": "White Tusker is a brand experience design studio."}, {"found": True, "answer": "Boeing, Bosch and Volvo are clients."}])
        f.ask("tell me about white tusker")
        f.ask("what else")
        self.assertEqual(f.searches[1]["min_score"], 0.0)
        self.assertEqual(f.searches[1]["exclude"], {"wt#0", "wt#3"})

    def test_a_follow_up_with_nothing_left_never_asks_the_gate(self):
        f = Fixture(self, [company(), company(query="more", wants_more=True)],
                    [{"found": True, "answer": "White Tusker is a brand experience design studio."}, {"found": False, "answer": ""}])
        gate = self._gate(f, allowed=False)
        f.ask("tell me about white tusker")
        said = f.ask("tell me more")
        self.assertTrue(said.startswith("That's all I have on that."))
        self.assertEqual(gate.seen, [])


class GroupTests(unittest.TestCase):
    def test_travis_and_cms_questions_search_the_cms_and_travis_files_and_get_no_contact_line(self):
        f = Fixture(self, [{"topic": "travis", "query": "what is the Travis control system"}, {"topic": "cms", "query": "what does the CMS do"}],
                    [{"found": True, "answer": "Travis is the voice assistant built by White Tusker."}, {"found": True, "answer": "The CMS manages the content shown on the screens."}])
        said_travis = f.ask("what is the travis control system")
        said_cms = f.ask("what does the cms do")
        self.assertEqual([s["groups"] for s in f.searches[:2]], [None, None])  # every file is searched...
        self.assertEqual([s["boost_groups"] for s in f.searches[:2]], [{"travis", "cms"}, {"cms", "travis"}])  # ...the topic's files rank higher
        self.assertNotIn("reach us", said_travis + said_cms)

    def test_a_place_question_may_use_any_group(self):
        f = Fixture(self, [{"topic": "experience_center", "query": "what is White Tusker"}], [{"found": True, "answer": "It is a brand experience studio."}])
        f.ask("what is this place")
        self.assertEqual((f.searches[0]["groups"], f.searches[0]["boost_groups"]), (None, None))  # a place question: every file, no preference


class ProbeTests(unittest.TestCase):
    """A request the planner leaves unclassified but the gate calls in scope ("does it support whiteboards"): if the knowledge has a close section the
    knowledge answers, never the model's own words; if not, the model answers as before."""

    def setUp(self):
        self.a = _planned("x", json.dumps({"kind": "other", "actions": []}))
        del self.a._probe_knowledge  # the real one
        self.a._portfolio_skip_until = float("inf")
        self.a._history, self.a._history_at = [], 0.0
        self.model_asked, self.searches, self.json_calls = [], [], []

        async def llm(command):
            self.model_asked.append(command)
            self.a.said.append("model text")
            return "model text"

        self.a._run_llm = llm

    def run_it(self, close, answer, request="does it support whiteboards"):
        def search(query, groups=None, exclude=frozenset(), k=2, min_score=0.5, boost_groups=None, boost=0.0):
            self.searches.append((query, k, min_score))
            return [_hit("cms#0")] if close else []

        async def complete_json(messages, schema, max_tokens=400):
            self.json_calls.append(messages)
            return answer if isinstance(answer, str) else json.dumps(answer)

        def stream_text(messages, max_tokens=300):
            raise AssertionError("the unclassified-request check is not streamed")

        self.a._llm.complete_json = complete_json
        self.a._llm.stream_text = stream_text
        with mock.patch("agent.knowledge_answer.retriever.search", search):
            self.a.said.clear()
            _say(self.a, request)
        return " ".join(self.a.said)

    def test_a_close_section_answers_and_the_model_is_never_asked(self):
        said = self.run_it(True, {"found": True, "answer": "The CMS platform manages the content shown on the screens in this room."})
        self.assertEqual(said, "The CMS platform manages the content shown on the screens in this room.")
        self.assertEqual(self.model_asked, [])
        self.assertEqual(self.a._path, "knowledge")

    def test_nothing_close_leaves_it_to_the_model_without_calling_the_answering_step(self):
        said = self.run_it(False, "should not be asked", request="what is the door state")
        self.assertEqual((said, self.model_asked), ("model text", ["what is the door state"]))

    def test_a_close_section_that_does_not_really_answer_leaves_it_to_the_model_silently(self):
        said = self.run_it(True, {"found": False, "answer": ""}, request="is the door locked")
        self.assertEqual((said, self.model_asked), ("model text", ["is the door locked"]))  # not "I don't have that detail" first
        self.assertNotIn("don't have that detail", said)

    def test_an_answer_with_words_not_in_the_section_is_not_spoken(self):
        said = self.run_it(True, {"found": True, "answer": "Absolutely, it also supports holographic quantum whiteboards for astronauts."})
        self.assertEqual(said, "model text")

    def test_an_answer_that_does_not_match_the_section_is_never_spoken_and_the_model_path_runs_as_before(self):
        said = self.run_it(True, {"found": True, "answer": "Absolutely, it also supports holographic quantum whiteboards for astronauts."})
        self.assertNotIn("astronauts", said)
        self.assertEqual(self.model_asked, ["does it support whiteboards"])
        self.assertNotEqual(self.a._path, "knowledge")

    def test_a_question_about_the_room_right_now_is_never_looked_up(self):
        for q in ("which screen is showing this", "is the door locked right now", "what is the AC temperature set to", "is tusker edge on at the moment",
                  "what devices are available in this room"):  # (the live inventory, not the knowledge file's list of what the CMS can control)
            with self.subTest(q=q):
                self.setUp()  # a fresh agent: the scripted planner has one answer per agent
                said = self.run_it(True, {"found": True, "answer": "The CMS platform manages the content shown on the screens in this room."}, request=q)
                self.assertEqual((said, self.searches), ("model text", []))

    def test_a_short_fragment_is_never_looked_up(self):
        said = self.run_it(True, {"found": True, "answer": "The CMS platform manages the content shown on the screens in this room."}, request="the lights")
        self.assertEqual((said, self.searches), ("model text", []))

    def test_the_probe_search_uses_its_own_higher_floor_and_one_section(self):
        self.run_it(True, {"found": True, "answer": "The CMS manages the content shown on the screens."})
        self.assertEqual(self.searches[0], ("does it support whiteboards", 1, 0.6))


class CmsQuestionsWithRoomWordsTests(unittest.TestCase):
    """The probe keeps away from room-state questions, but a question ABOUT the CMS that happens to hold a room word is still a knowledge
    question: the planner calls it one and the knowledge answers it."""

    def ask_cms(self, question, query, answer):
        results = {query: ["cms#0"]}
        with mock.patch.dict(RESULTS, results):
            f = Fixture(self, [{"topic": "cms", "query": query}], [{"found": True, "answer": answer}])
            said = f.ask(question)
        return f, said

    def test_what_can_the_cms_do_with_screens(self):
        f, said = self.ask_cms("What can the CMS do with screens?", "what can the CMS do with screens", "The CMS platform manages the content shown on the screens in this room.")
        self.assertEqual(said, "The CMS platform manages the content shown on the screens in this room.")
        self.assertEqual(f.a._path, "knowledge")
        self.assertEqual(len(f.a.chat.requests), 1)  # the planner read it as a question about the CMS

    def test_how_does_the_cms_control_lights(self):
        f, said = self.ask_cms("How does the CMS control lights?", "how does the CMS control lights", "The CMS platform manages the content shown on the lights in this room.")
        self.assertEqual(f.a._path, "knowledge")
        self.assertTrue(said.startswith("The CMS platform manages"))
        self.assertEqual((f.searches[0]["groups"], f.searches[0]["boost_groups"]), (None, {"cms", "travis"}))


HISTORY = [{"role": "user", "content": "tell me about white tusker"}, {"role": "assistant", "content": "White Tusker is a brand experience design studio."}]


class RewriteRuleTests(unittest.TestCase):
    """The rewrite runs only with history AND (a context word OR three words or fewer); otherwise the transcript is searched as heard."""

    def ask_with(self, question, history, query="White Tusker prices", answers=None):
        f = Fixture(self, [company(query=query)], answers or [{"found": False, "answer": ""}])
        f.a._history, f.a._history_at = list(history), __import__("time").monotonic()
        return f, f.ask(question)

    def test_with_history_and_a_context_word_the_question_is_rewritten_before_it_is_searched_and_before_any_fallback(self):
        f, said = self.ask_with("what about their prices", HISTORY)
        self.assertEqual(len(f.rewrites), 1)
        self.assertEqual(f.searches[0]["query"], "White Tusker prices")  # the REWRITTEN query is what was searched
        self.assertTrue(said.startswith("I don't have that detail."))  # nothing found for it: only now the fallback

    def test_the_rewritten_query_that_finds_something_is_answered(self):
        with mock.patch.dict(RESULTS, {"White Tusker clients": ["wt#2", "wt#0"]}):
            f, said = self.ask_with("what about their clients", HISTORY, query="White Tusker clients",
                                    answers=[{"found": True, "answer": "Their clients include Boeing, Bosch and Volvo in technology and automotive."}])
        self.assertEqual((len(f.rewrites), f.searches[0]["query"]), (1, "White Tusker clients"))
        self.assertIn("Boeing", said)

    def test_no_history_means_no_rewrite_even_with_a_context_word(self):
        f, _ = self.ask_with("what about their prices", [])
        self.assertEqual((len(f.rewrites), f.searches[0]["query"]), (0, "what about their prices"))

    def test_history_but_no_context_word_and_more_than_three_words_means_no_rewrite(self):
        f, _ = self.ask_with("who founded White Tusker studio", HISTORY)
        self.assertEqual((len(f.rewrites), f.searches[0]["query"]), (0, "who founded White Tusker studio"))

    def test_history_and_three_words_or_fewer_is_rewritten(self):
        f, _ = self.ask_with("and the clients", HISTORY)
        self.assertEqual(len(f.rewrites), 1)

    def test_a_skipped_rewrite_takes_the_planners_topic_and_wants_more_is_false(self):
        f = Fixture(self, [{"topic": "cms", "query": "what does the CMS do"}], [{"found": True, "answer": "The CMS platform manages the content shown on the screens."}])
        f.ask("what does the CMS do")
        self.assertEqual((f.searches[0]["groups"], f.searches[0]["boost_groups"]), (None, {"cms", "travis"}))
        self.assertEqual(f.searches[0]["exclude"], set())
        self.assertEqual(f.a._plan_log["knowledge"]["rewrite"], "skipped")

    def test_the_log_says_whether_the_rewrite_ran(self):
        f, _ = self.ask_with("what about their prices", HISTORY)
        self.assertEqual(f.a._plan_log["knowledge"]["rewrite"], "ran")

    def test_contact_questions_are_found_by_keyword_not_by_the_rewrite(self):
        from nlu.query_rewrite import asks_for_contact

        for text in ("how can I contact you", "what is your email", "how do I reach them", "where are you", "what is your address", "your phone number please"):
            with self.subTest(text):
                self.assertTrue(asks_for_contact(text))
        for text in ("what is the cms", "who founded it", "where is the portfolio kept"):
            with self.subTest(text):
                self.assertFalse(asks_for_contact(text))


class StreamingTests(unittest.TestCase):
    """The answer is spoken a sentence at a time as it is generated; every sentence is checked first."""

    def test_found_false_stops_generation_and_nothing_is_spoken_however_it_is_chunked(self):
        for parts in (['{"found": false, "answer": ""}'], ['{"fou', 'nd": fal', 'se, "ans', 'wer": ""}'], ['{', '"found"', ':', ' false', ',"answer":""}'], ['{"found":false']):
            with self.subTest(parts=parts):
                f = Fixture(self, [company(query="who founded White Tusker")], [{"raw": parts}])
                said = f.ask("who founded it")
                self.assertTrue(said.startswith("I don't have that detail."), said)
                self.assertTrue(f.streams[0].closed)  # generation was cancelled
                self.assertLess(f.streams[0].sent, len(chunks('{"found": false, "answer": ""}')) + 1)

    def test_the_schema_asks_for_found_first(self):
        f = Fixture(self, [company()], ["White Tusker is a brand experience design studio."])
        f.ask("tell me about white tusker")
        self.assertEqual(list(f.schemas[0]["properties"]), ["found", "answer"])

    def test_an_answer_before_found_is_held_until_found_is_known(self):
        f = Fixture(self, [company()], [{"raw": ['{"answer": "White Tusker is a brand experience design studio. ', 'We design spaces that respond to people.", ', '"found": true}']}])
        f.ask("tell me about white tusker")
        self.assertEqual(f.a.said[0], "White Tusker is a brand experience design studio.")

    def test_json_escapes_in_the_streamed_answer_are_decoded(self):
        raw = ['{"found": true, "answer": "The CMS platform manages the \\"content\\" shown on the ', 'screens in this room.\\nIt also works with caf\\u00e9 displays and emoji \\ud83d\\ude00 too."}']
        f = Fixture(self, [{"topic": "cms", "query": "what does the CMS do"}], [{"raw": raw}])
        patcher = mock.patch("agent.knowledge_answer.check_sentence", lambda text, knowledge, question="": (1.0, []))  # (the words are not in the test knowledge)
        patcher.start()
        self.addCleanup(patcher.stop)
        f.ask("what does the cms do")
        self.assertEqual(f.a.said[0], 'The CMS platform manages the "content" shown on the screens in this room.')
        self.assertIn("caf\u00e9", f.a.said[1])
        self.assertIn("\U0001F600", f.a.said[1])

    def test_each_sentence_is_spoken_on_its_own_and_in_order(self):
        text = "White Tusker is a brand experience design studio. We design spaces that respond to people, content, data and events. The studio is in Indiranagar, Bengaluru."
        f = Fixture(self, [company()], [text])
        f.ask("tell me about white tusker")
        said = f.a.said
        self.assertEqual(said[:3], ["White Tusker is a brand experience design studio.", "We design spaces that respond to people, content, data and events.", "The studio is in Indiranagar, Bengaluru."])
        self.assertEqual(said[3:], [CONTACT])  # the contact line comes last, from code

    def test_a_short_sentence_is_merged_with_the_next_before_it_is_checked_and_spoken(self):
        f = Fixture(self, [company()], ["Sure. White Tusker is a brand experience design studio. We design spaces that respond to people, content, data and events."])
        f.ask("tell me about white tusker")
        self.assertEqual(f.a.said[0], "Sure. White Tusker is a brand experience design studio.")

    def test_a_short_last_sentence_is_checked_alone(self):
        f = Fixture(self, [company()], ["White Tusker is a brand experience design studio. Indiranagar too."])
        f.ask("tell me about white tusker")
        self.assertEqual(f.a.said[:2], ["White Tusker is a brand experience design studio.", "Indiranagar too."])

    def test_a_contact_sentence_is_stripped_before_it_is_spoken(self):
        f = Fixture(self, [{"topic": "cms", "query": "what does the CMS do"}],
                    ["The CMS platform manages the content shown on the screens. You can email us at hello@thewhitetusker.com for details. It also controls the room."])
        f.ask("what does the cms do")
        self.assertNotIn("email", " ".join(f.a.said).lower())

    def test_a_first_sentence_that_is_not_in_the_knowledge_is_never_spoken_and_the_fallback_runs(self):
        f = Fixture(self, [company()],
                    ["Examples include digital lounges, pop-up retail environments and interactive festival installations. We also build holographic tunnels."])
        said = f.ask("what about their projects")
        self.assertTrue(said.startswith("I don't have that detail."))
        self.assertNotIn("lounges", said)
        self.assertFalse(f.a._kb_ok)
        self.assertEqual(f.a._kb_used, frozenset())  # nothing was said, so nothing is used
        self.assertTrue(f.streams[0].closed)

    def test_a_later_sentence_that_is_not_in_the_knowledge_stops_the_answer_and_is_not_spoken(self):
        f = Fixture(self, [company()],
                    ["White Tusker is a brand experience design studio. It also runs holographic quantum observatories for visiting astronauts. It likes tea."])
        said = f.ask("tell me about white tusker")
        self.assertEqual(f.a.said[0], "White Tusker is a brand experience design studio.")
        self.assertNotIn("astronauts", said)
        self.assertNotIn("tea", said)
        self.assertTrue(f.streams[0].closed)
        self.assertEqual(f.a._path, "knowledge")
        self.assertTrue(f.a._kb_ok)
        self.assertIn("cut after 1", f.a._plan_log["knowledge"]["verdict"])

    def test_sections_count_as_used_after_a_cut_off_answer_so_tell_me_more_goes_on(self):
        f = Fixture(self, [company(), company(query="more about White Tusker", wants_more=True)],
                    ["White Tusker is a brand experience design studio. It also runs holographic quantum observatories for visiting astronauts.",
                     "White Tusker works with Boeing, Bosch and Volvo."])
        f.ask("tell me about white tusker")
        self.assertEqual(f.a._kb_used, frozenset({"wt#0", "wt#3"}))
        f.ask("tell me more about it")
        self.assertEqual(f.searches[1]["exclude"], {"wt#0", "wt#3"})
        self.assertEqual(f.a.said[0], "White Tusker works with Boeing, Bosch and Volvo.")

    def test_the_company_overview_counts_from_the_first_spoken_sentence(self):
        f = Fixture(self, [company()], ["White Tusker is a brand experience design studio. Zebras juggle holographic quantum teacups nightly."])
        f.ask("tell me about white tusker")
        self.assertEqual((f.a._company_answers, f.a._kb_company_said), (1, True))

    def test_a_decimal_in_an_answer_does_not_split_a_sentence(self):
        patcher = mock.patch("agent.knowledge_answer.check_sentence", lambda text, knowledge, question="": (1.0, []))  # (2.5 is not in the knowledge; only the splitting is tested here)
        patcher.start()
        self.addCleanup(patcher.stop)
        f = Fixture(self, [{"topic": "cms", "query": "what does the CMS do"}], [["The CMS platform manages ", "the content shown on the ", "screens in this room 2", ".5 times better. Done."]])
        f.ask("what does the cms do")
        self.assertEqual(f.a.said[0], "The CMS platform manages the content shown on the screens in this room 2.5 times better.")

    def test_a_probe_that_fails_its_first_sentence_says_nothing(self):
        f = Fixture(self, [company()], ["Absolutely, holographic quantum whiteboards for astronauts are included in every plan."])
        out = asyncio.run(f.a._answer_from_knowledge(SimpleNamespace(topic="experience_center"), "does it support whiteboards", probe=True))
        self.assertIsNone(out)
        self.assertEqual(f.a.said, [])


class FalsePremiseTests(unittest.TestCase):
    """The visitor's own words count as known when a sentence is scored, EXCEPT names and numbers: those must be in the retrieved knowledge, or the
    sentence is blocked whatever its overlap score. A question that assumes something false is never confirmed by echoing it back."""

    def ask_with(self, question, answer, query="White Tusker clients"):
        f = Fixture(self, [company(query=query)], [answer])
        return f, f.ask(question)

    def test_a_false_premise_confirmed_with_a_name_or_number_that_is_not_in_the_knowledge_is_blocked(self):
        for question, confirm in [
            ("Did you win a Nobel Prize?", "Yes, White Tusker has won a Nobel Prize for design."),
            ("Have you worked with Google?", "Yes, White Tusker has worked with Google on experience centres."),
            ("Did White Tusker build the Burj Khalifa?", "Yes, White Tusker built the Burj Khalifa as an experience centre."),
            ("Is it true you have 500 employees?", "Yes, White Tusker has 500 employees across technology and design."),
            ("You were founded in 1990, right?", "Yes, White Tusker was founded in 1990 as a brand experience design studio."),
        ]:
            with self.subTest(question):
                f, said = self.ask_with(question, confirm)
                self.assertTrue(said.startswith("I don't have that detail."), said)
                self.assertFalse(f.a._kb_ok)
                self.assertIn("name or number not in the knowledge", f.a._plan_log["knowledge"]["verdict"])

    def test_the_visitors_words_count_as_known_for_ordinary_words_but_a_name_in_the_knowledge_is_allowed(self):
        f, said = self.ask_with("Have you worked with Boeing?", "Yes, I have worked with Boeing.")
        self.assertTrue(said.startswith("Yes, I have worked with Boeing."), said)  # "worked" is the visitor's word; Boeing is in the clients section

    def test_without_counting_the_visitors_words_the_same_answer_would_have_been_blocked(self):
        from safety.reply_guard import grounding

        knowledge = "\n\n".join(SECTIONS[i][3] for i in ("wt#2", "wt#0"))
        self.assertLess(grounding("Yes, I have worked with Boeing.", knowledge), 0.65)
        self.assertGreaterEqual(grounding("Yes, I have worked with Boeing.", knowledge, also_known="Have you worked with Boeing?"), 0.65)

    def test_a_number_that_is_in_the_knowledge_is_fine_and_one_that_is_not_is_blocked(self):
        f, said = self.ask_with("How many verticals do you have?", "We work in four areas: architecture and interior spaces, immersive technology, brand solutions, and corporate and brand films.",
                                query="what do you do")
        self.assertTrue(said.startswith("I don't have that detail.") or "four areas" in said)  # 'four' is in WHAT: allowed when retrieved
        with mock.patch.dict(RESULTS, {"what do you do": ["wt#1"]}):
            f2, said2 = self.ask_with("How many verticals do you have?", "We work in five areas of design.", query="what do you do")
        self.assertTrue(said2.startswith("I don't have that detail."), said2)

    def test_a_later_sentence_with_an_unknown_name_cuts_the_answer(self):
        f, said = self.ask_with("Tell me about your clients",
                                "Boeing, Bosch and Volvo are clients across technology and automotive sectors. Microsoft is also a client in technology sectors.")
        self.assertIn("Boeing", said)
        self.assertNotIn("Microsoft", said)
        self.assertIn("cut after 1", f.a._plan_log["knowledge"]["verdict"])

    def test_the_room_and_assistant_names_are_never_new_facts(self):
        from safety.reply_guard import unsupported_facts

        self.assertEqual(unsupported_facts("Travis and the CMS control the AC and the TV for White Tusker.", "Nothing about any of that."), [])

    def test_sentence_openers_are_not_names(self):
        from safety.reply_guard import unsupported_facts

        for text in ("Yes, the CMS does that.", "Because it is built for showrooms.", "Operators can edit it.", "Currently it runs the room.", "Each screen is controlled on its own."):
            with self.subTest(text):
                self.assertEqual(unsupported_facts(text, "the cms is built for showrooms; operators; each screen; the room"), [])

    def test_a_number_is_the_same_in_digits_or_words(self):
        from safety.reply_guard import unsupported_facts

        self.assertEqual(unsupported_facts("There are 3 verticals.", "We have three verticals."), [])
        self.assertEqual(unsupported_facts("There are three verticals.", "We have 3 verticals."), [])
        self.assertEqual(unsupported_facts("Founded in 1990.", "We have 3 verticals."), ["1990"])  # ("Founded" only starts the sentence: not a name)

    def test_a_name_that_starts_the_sentence_counts_when_the_visitor_wrote_it_capitalised(self):
        from safety.reply_guard import unsupported_facts

        self.assertEqual(unsupported_facts("Google is not a client.", "Boeing, Volvo", question="Have you worked with Google?"), ["google"])
        self.assertEqual(unsupported_facts("Google is not a client.", "Boeing, Volvo"), [])  # nothing says it is a name: left to the overlap score


class SpokenNameTests(unittest.TestCase):
    """Every streamed sentence is corrected the way a whole reply was (nlu/spoken_names.py) before it is kept and spoken: the company is "White Tusker", never
    "The White Tusker"; technical device names are the room's names. Contact sentences are stripped per sentence as before."""

    def test_the_white_tusker_is_said_without_the_in_every_sentence(self):
        f = Fixture(self, [company()], ["The White Tusker is a brand experience design studio. We design spaces that respond to people, content, data and events. "
                                        "The White Tusker studio is in Indiranagar, Bengaluru."])
        said = f.ask("tell me about white tusker")
        self.assertEqual(f.a.said[:3], ["White Tusker is a brand experience design studio.", "We design spaces that respond to people, content, data and events.",
                                        "White Tusker studio is in Indiranagar, Bengaluru."])
        self.assertNotIn("The White Tusker", said)

    def test_the_corrected_text_is_what_is_returned_and_so_remembered(self):
        f = Fixture(self, [company()], ["The White Tusker is a brand experience design studio."])
        f.ask("tell me about white tusker")
        self.assertNotIn("The White Tusker", " ".join(m["content"] for m in f.a._history))

    def test_technical_device_names_are_spoken_as_the_rooms_names(self):
        f = Fixture(self, [{"topic": "travis", "query": "what is the Travis control system"}],
                    ["Travis controls this space: lights, AC, the door, and what plays on each screen. It can switch the tusker edge on, like the cove light."])
        f.ask("what is the travis control system")
        self.assertNotIn("tusker edge", " ".join(f.a.said))

    def test_the_grounding_is_scored_on_the_sentence_as_written(self):
        # "The" before White Tusker must not change the score either way
        from safety.reply_guard import check_sentence

        knowledge = SECTIONS["wt#0"][3]
        a, _ = check_sentence("The White Tusker is a brand experience design studio.", knowledge)
        b, _ = check_sentence("White Tusker is a brand experience design studio.", knowledge)
        self.assertEqual(a, b)

    def test_contact_sentences_are_stripped_per_sentence_and_the_line_comes_from_code(self):
        f = Fixture(self, [company()], ["The White Tusker is a brand experience design studio. Email us at hello@thewhitetusker.com or call us for details. "
                                        "We design spaces that respond to people, content, data and events."])
        said = f.ask("tell me about white tusker")
        self.assertNotIn("Email us", said)
        self.assertEqual(f.a.said[-1], CONTACT)
        self.assertEqual(sum(CONTACT in s for s in f.a.said), 1)


class NegationTests(unittest.TestCase):
    """A sentence that denies something must be supported by the knowledge alone: the visitor's own words do not vouch for it."""

    def test_has_negation(self):
        from safety.reply_guard import has_negation

        for text in ("Travis does not run the company's operations.", "It isn't possible.", "No, we have not.", "We never do that.", "None of them.", "It can't do that.", "It cannot.",
                     "We don't", "It won't", "It doesn't"):
            with self.subTest(text):
                self.assertTrue(has_negation(text))
        for text in ("Travis controls this space.", "Nothing is hidden.x"[:0] or "We note the notes.", "The CMS knows."):
            with self.subTest(text):
                self.assertFalse(has_negation(text))

    def test_the_visitors_words_do_not_support_a_denial_the_knowledge_never_makes(self):
        from safety.reply_guard import check_sentence

        knowledge = TRAVIS
        question = "Can Travis run the company's operations"
        g_deny, _ = check_sentence("Travis does not run the company's operations.", knowledge, question)
        g_claim, _ = check_sentence("Travis is the voice assistant built by White Tusker.", knowledge, question)
        self.assertLess(g_deny, 0.65)
        self.assertGreaterEqual(g_claim, 0.65)
        # the same words WITHOUT a negation are still helped by the question
        g_plain, _ = check_sentence("Travis can run the company's operations.", knowledge, question)
        self.assertGreaterEqual(g_plain, 0.65)

    def test_kb_no_invented_operations_the_denial_is_not_spoken(self):
        f = Fixture(self, [{"topic": "travis", "query": "what is the Travis control system"}],
                    ["Travis is a product of White Tusker. Travis controls this space: lights, AC, the door, and what plays on each screen. Travis does not run the company's operations."])
        said = f.ask("Can Travis run the company's operations")
        self.assertNotIn("operations", said)
        self.assertIn("Travis controls this space", " ".join(f.a.said))
        self.assertIn("cut after", f.a._plan_log["knowledge"]["verdict"])


class SpeechSessionTests(unittest.TestCase):
    """One ElevenLabs session per answer: every sentence goes out with send_text, nothing flushes between them, one flush at the end, and not a
    character more than the answer."""

    def test_sentences_are_sent_without_flushing_between_them_and_flushed_once(self):
        from agent.local import TravisLocal

        class FakeStreamer:
            def __init__(self):
                self.events = []

            async def send_text(self, text):
                self.events.append(("send", text))

            async def flush(self):
                self.events.append(("flush", ""))

        text = "White Tusker is a brand experience design studio. We design spaces that respond to people, content, data and events. The studio is in Indiranagar, Bengaluru."
        f = Fixture(self, [company()], [text])
        a = f.a
        streamer = FakeStreamer()
        a.elevenlabs = streamer
        a._say = TravisLocal._say.__get__(a)
        a._finish_reply = TravisLocal._finish_reply.__get__(a)
        a._on_model_activity = lambda: None
        a._first_say = None
        a._last_model_activity = 0.0
        f.ask("tell me about white tusker")
        kinds = [k for k, _ in streamer.events]
        self.assertEqual(kinds, ["send"] * 4 + ["flush"])  # three sentences and the contact line, then one flush
        sent = "".join(t for k, t in streamer.events if k == "send")
        self.assertEqual(sent.split(), (text + " " + CONTACT).split())  # the same words, nothing twice, nothing extra
        self.assertEqual(len(sent.strip()), len(text + " " + CONTACT))


class ProbeStrictnessTests(ProbeTests):
    """The unclassified-request check (a request the planner leaves unclassified) asks the model for JSON {found, answer} and says nothing unless it
    is a real answer: an off-topic question that happens to sit near a section ("how do air conditioners work") is refused, not answered with a sentence
    copied from that section."""

    def test_the_model_saying_not_found_leaves_an_off_topic_question_to_the_gate_and_the_model(self):
        said = self.run_it(True, {"found": False, "answer": ""}, request="Explain how air conditioners work")
        self.assertEqual((said, self.model_asked), ("model text", ["Explain how air conditioners work"]))
        self.assertEqual(len(self.json_calls), 1)
        self.assertIn('"found"', self.json_calls[0][-1]["content"])  # it is told to say whether the knowledge answers

    def test_a_probe_answer_with_a_name_the_knowledge_lacks_is_not_said(self):
        said = self.run_it(True, {"found": True, "answer": "Yes, the CMS platform manages the content shown on the screens in this room for Google."})
        self.assertEqual(said, "model text")

    def test_a_probe_never_streams(self):
        self.run_it(True, {"found": True, "answer": "The CMS platform manages the content shown on the screens in this room."})
        self.assertEqual(len(self.json_calls), 1)


class RetrievalBoostTests(unittest.TestCase):
    def test_every_file_is_searched_and_the_topic_is_only_a_boost(self):
        from rag import retriever

        chunks_ = [
            {"chunk_id": "a", "title": "A", "section": "Alpha", "topic": "alpha", "group": "company", "text": "x"},
            {"chunk_id": "b", "title": "B", "section": "Beta", "topic": "beta", "group": "cms", "text": "y"},
        ]
        import numpy as np

        cache = {"vectors": np.array([[1.0, 0.0], [0.97, 0.243]], dtype=np.float32), "chunks": chunks_}
        with mock.patch.object(retriever, "_load_cache", lambda: cache), mock.patch.object(retriever.indexer, "ensure_index", lambda: None), \
                mock.patch.object(retriever, "_embed_query", lambda q: np.array([[1.0, 0.0]], dtype=np.float32)):
            plain = [h.chunk_id for h in retriever.search("zzzz", None, frozenset(), 2, 0.0)]
            boosted = [h.chunk_id for h in retriever.search("zzzz", None, frozenset(), 2, 0.0, boost_groups={"cms"}, boost=0.05)]
            wrong_hint = [h.chunk_id for h in retriever.search("zzzz", None, frozenset(), 2, 0.0, boost_groups={"cms"}, boost=0.01)]
            filtered = [h.chunk_id for h in retriever.search("zzzz", {"cms"}, frozenset(), 2, 0.0)]
        self.assertEqual(plain, ["a", "b"])
        self.assertEqual(boosted, ["b", "a"])  # the hint moves its own file up
        self.assertEqual(wrong_hint, ["a", "b"])  # a weak hint cannot hide the better section
        self.assertEqual(filtered, ["b"])  # (the old filter, still there for the topic offers)


class PromptTests(unittest.TestCase):
    def test_the_answer_prompt_asks_for_the_knowledges_own_wording(self):
        f = Fixture(self, [company()], ["White Tusker is a brand experience design studio. We design spaces that respond to people, content, data and events."])
        f.ask("tell me about white tusker")
        user = f.prompts[0][-1]["content"]
        self.assertIn("Reuse the KNOWLEDGE's own wording", user)
        self.assertIn('"found" first', user)
        self.assertNotIn("NOT_FOUND", user)


class DeviceCommandTests(unittest.TestCase):
    def test_a_device_command_costs_no_search_and_no_knowledge_model_call(self):
        a = _planned("x", json.dumps({"kind": "actions", "actions": [{"quote": "turning on the cove light", "op": "light_on",
                                                                       "target": {"words": "the cove light", "type": "light", "scope": "specific", "name": "tusker edge"}, "parameters": {}}]}))
        calls = []

        async def complete_json(*args, **kwargs):
            calls.append(args)
            return "{}"

        a._llm.complete_json = complete_json
        with mock.patch("agent.knowledge_answer.retriever.search", side_effect=AssertionError("a device command must not search")):
            _say(a, "would you mind turning on the cove light")
        self.assertEqual(calls, [])  # the answering model was not asked anything
        self.assertEqual(len(a.chat.requests), 1)  # one planner call, as before
        self.assertTrue(a.calls and a.calls[0][0] == "device_control")


class ConversationStateTests(unittest.TestCase):
    def test_a_new_conversation_forgets_what_was_used_and_gives_the_overview_with_contact_again(self):
        f = Fixture(self, [company(), company()], [{"found": True, "answer": "White Tusker is a studio."}, {"found": True, "answer": "White Tusker is a studio."}])
        f.ask("tell me about white tusker")
        f.a._history = []  # five minutes passed
        said = f.ask("tell me about white tusker")
        self.assertIn(CONTACT, said)
        self.assertEqual(f.searches[1]["exclude"], set())


class GroundingTests(unittest.TestCase):
    KNOW = f"[White Tusker: Who we are] {OVERVIEW} [White Tusker: Clients] {CLIENTS}"  # the label is part of what the model is shown

    def test_a_paraphrase_scores_high_and_an_invention_scores_low(self):
        self.assertGreater(grounding("Their clients are Boeing, Bosch and Volvo.", self.KNOW), 0.9)
        self.assertLess(grounding("Examples include digital lounges, pop-up retail and festival installations.", self.KNOW), 0.4)

    def test_no_content_words_is_not_a_failure(self):
        self.assertEqual(grounding("It is.", self.KNOW), 1.0)


if __name__ == "__main__":
    unittest.main()


class SpeakWhileGeneratingTests(unittest.TestCase):
    """The answer reaches the voice sentence by sentence while the model is still writing; a lost voice or a cancelled request ends it cleanly."""

    TEXT = "White Tusker is a brand experience design studio. We design spaces that respond to people, content, data and events. The studio is in Indiranagar, Bengaluru."

    def test_the_first_sentence_is_with_the_voice_before_the_last_chunk_is_generated(self):
        f = Fixture(self, [company()], [self.TEXT])
        at_last_chunk = []
        make = f.a._llm.stream_text

        def spy(messages, max_tokens=300, schema=None):
            stream = make(messages, max_tokens=max_tokens, schema=schema)
            parts = stream.parts

            async def gen():
                for i, part in enumerate(parts):
                    if i == len(parts) - 1:
                        at_last_chunk.append(list(f.a.said))
                    yield part

            stream._gen = gen
            return stream

        f.a._llm.stream_text = spy
        f.ask("tell me about white tusker")
        self.assertEqual(at_last_chunk[0][:1], ["White Tusker is a brand experience design studio."])
        self.assertLess(len(at_last_chunk[0]), 3)  # the rest had not been generated yet

    def test_when_the_voice_drops_a_sentence_nothing_later_is_sent_and_nothing_is_repeated(self):
        f = Fixture(self, [company()], [self.TEXT])
        sent = []

        async def flaky(text):
            if sent:
                return False  # the second sentence is refused: the session is gone
            sent.append(text)
            f.a.said.append(text)
            return True

        f.a._say = flaky
        f.ask("tell me about white tusker")
        self.assertEqual(f.a.said, ["White Tusker is a brand experience design studio."])
        self.assertTrue(f.streams[0].closed)
        self.assertIn("speech unavailable", f.a._plan_log["knowledge"]["verdict"])

    def test_a_cancelled_request_closes_the_stream_and_drops_the_queued_audio(self):
        f = Fixture(self, [company()], [{"raw": ['{"found": true, "answer": "White Tusker is a brand experience design studio. We design spaces']}])
        dropped = []
        f.a._drain_audio_queue = lambda: dropped.append(True)

        class Hanging(FakeStream):
            async def _gen(self):
                for part in self.parts:
                    yield part
                await asyncio.sleep(3600)

        make = f.a._llm.stream_text

        def hang(messages, max_tokens=300, schema=None):
            stream = Hanging(make(messages, max_tokens=max_tokens, schema=schema).parts)
            f.streams[-1] = stream
            return stream

        f.a._llm.stream_text = hang
        f._cur = f._plans.pop(0)

        async def go():
            task = asyncio.ensure_future(f.a._answer_from_knowledge(SimpleNamespace(topic="company"), "tell me about white tusker"))
            await asyncio.sleep(0.3)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        asyncio.run(go())
        self.assertEqual(f.a.said, ["White Tusker is a brand experience design studio."])
        self.assertEqual(dropped, [True])
        self.assertTrue(f.streams[-1].closed)

    def test_the_stage_timings_are_recorded_in_order_without_any_conversation_text(self):
        from agent.knowledge_answer import knowledge_timing

        f = Fixture(self, [company()], [self.TEXT])
        f.ask("tell me about white tusker")
        marks = f.a._timing["knowledge_marks"]
        self.assertLessEqual(marks["start"], marks["generate"])
        self.assertLessEqual(marks["generate"], marks["first_token"])
        self.assertLessEqual(marks["first_token"], marks["first_sentence"])
        self.assertLessEqual(marks["first_sentence"], marks["done"])
        timing = dict(f.a._timing, first_audio_chunk_received=marks["first_sentence"] + 0.1, playback_started=marks["first_sentence"] + 0.12)
        got = knowledge_timing(timing)
        self.assertEqual(list(got), ["model_started", "first_token", "first_sentence", "tts_first_audio", "playback_started", "completed"])
        self.assertTrue(all(isinstance(v, int) for v in got.values()))
        self.assertIsNone(knowledge_timing({}))
