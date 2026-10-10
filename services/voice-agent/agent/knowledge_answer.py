"""Answering questions about the company, the CMS, Travis or this place from the knowledge base.

The planner (nlu/planner.py) has already decided this is a question about the company, the CMS, Travis or this place. One small
call (nlu/query_rewrite.py) restates it on its own ("tell me more about it" -> "more about White Tusker") and says whether it asks for
MORE of what was said or how to reach the company. Software does the rest, in this order, so the answering model never has to decide
whether to look anything up:

    search the sections of the right group (company / Travis / CMS), skipping the ones already used when the visitor wants more
    -> the model answers from just those sections, saying whether they really contain what was asked
    -> a grounding check on its words (safety/reply_guard.py)
    -> contact line and topic offers are added by this code, never written by the model

A device command never gets here (it is not kind "question"), so it costs no search and no extra model call.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from types import SimpleNamespace

from nlu.local_llm import LocalLLMError
from nlu.query_rewrite import _FROM_PLANNER, asks_for_contact, needs_rewrite, rewrite_question
from nlu.json_answer import ANSWER_SCHEMA, AnswerStream
from nlu.sentences import MIN_WORDS, SentenceSplitter, word_count
from nlu.spoken_names import say_names
from rag import retriever
from safety.reply_guard import check_sentence, grounding, unsupported_facts, without_contact
from settings import load_api_config

PROBE_MIN_WORDS = 4
# A question about what the room is doing NOW ("which screen is showing this") is answered from live CMS data, never from the knowledge file
ROOM_WORDS = frozenset("screen screens light lights lamp ac aircon temperature door lock locked volume tv display soundbar playing brightness".split())
DEFAULT_CONTACT_LINE = "You can reach us at hello at thewhitetusker dot com."
# The CMS and Travis are one product to a visitor (the CMS file says what Travis can do, Travis's file what it controls), so each searches both.
GROUPS = {"company": {"company"}, "cms": {"cms", "travis"}, "travis": {"travis", "cms"}, "experience_center": {"company", "travis", "cms"}}
# The model decides FIRST: structured output {"found", "answer"}, "found" before "answer". The decision is read as soon as it arrives (false: generation
# stops and nothing is spoken), then the answer is streamed and spoken sentence by sentence. The strict "found" flag is what keeps an off-topic question
# that happens to sit near a section ("how do air conditioners work") from being answered with a sentence copied from that section.
RULES_JSON = (
    'Reply as JSON {"found": ..., "answer": ...}, "found" first. "found" is true ONLY if the KNOWLEDGE actually states what the visitor asked for (for "who '
    'founded it" the names of the founders; for "projects" real projects). If it does not, "found" is false and "answer" is empty. "answer": two or three short '
    "spoken sentences using only words and facts from the KNOWLEDGE, answering only what was asked. Do not repeat what you already said in this "
    "conversation. Say \"White Tusker\", never \"The White Tusker\". Never write an email, phone number or address."
)
RULES = RULES_JSON + " Reuse the KNOWLEDGE's own wording and terms where you can, rather than paraphrasing."
TOPIC_BOOST = 0.0  # added to the score of the sections of the planner's topic (config knowledge_topic_boost). 0 = off: the planner's topic is sometimes wrong
# ("What is your one line description" -> "travis") and even +0.01 pushed the right section out of the top 3. A hint, never a filter.

# Lines of the knowledge that carry contact details: the model never sees them (the contact line is added by code).
_CONTACT_LINE = re.compile(r"@|https?://|www\.|\.com\b|^\s*(?:e-?mail|phone|tel|website|call)\b\s*:", re.I | re.M)


def _without_contact_lines(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not _CONTACT_LINE.search(line)).strip()


class KnowledgeMixin:
    """The `question` branch of the planner path (agent/planning.py). Needs `_recent_history`, `_say`, `_llm`, `_system_prompt`."""

    _kb_used: frozenset = frozenset()  # section ids already used in this conversation
    _kb_company_said = False  # the company overview (with the contact line) has been given in this conversation
    _kb_ok = False  # the last knowledge answer was a real answer (not "I don't have that detail")
    _company_answers = 0  # real answers about White Tusker in this conversation (FAQ or knowledge): the portfolio is offered from the second
    _portfolio_offered = False  # at most once per conversation
    _portfolio_declined = False
    _kb_last_topic = "company"  # the planner topic of the last real answer: what "tell me more" continues

    def _new_conversation_check(self):
        """Nothing in memory any more (5 minutes passed): a new conversation, so nothing is "used" and nothing was offered or declined."""
        if not self._recent_history():
            self._kb_used, self._kb_company_said = frozenset(), False
            self._company_answers, self._portfolio_offered, self._portfolio_declined = 0, False, False

    def _decline_text(self) -> str:
        """The refusal for something off topic: the next of the three wordings (never the one just used), or the one pinned in the config /
        set on the agent."""
        from agent.local import DECLINES

        if self._off_topic_reply not in DECLINES:
            return self._off_topic_reply
        self._decline_last = (self._decline_last + 1) % len(DECLINES)
        return DECLINES[self._decline_last]

    def _has_previous_answer(self) -> bool:
        """A knowledge answer (later also an FAQ answer: it marks its sections used the same way) is still in memory, so "tell me more" has
        something to continue."""
        return bool(self._recent_history()) and bool(self._kb_used)

    async def _probe_knowledge(self, request: str) -> str | None:
        """For a request the planner left unclassified (an in-scope "does it support whiteboards"): if the knowledge has a section close to it,
        answer from the knowledge. None = nothing close, or no real answer in it; nothing was said and the model answers as before. The model's own
        words are never trusted for a fact about the company, the CMS or Travis: it once said the CMS has no whiteboards when the file says it does."""
        words = re.findall(r"[a-z0-9']+", request.lower())
        if len(words) < PROBE_MIN_WORDS:  # "The lights." is a fragment to ask about, not a question to look up
            return None
        if ROOM_WORDS & set(words) or any(n.lower() in request.lower() for n in self._device_words()):
            return None
        cfg = load_api_config()
        floor = float(cfg.get("knowledge_probe_min_score", 0.6))
        try:
            close = await asyncio.get_running_loop().run_in_executor(
                None, lambda: retriever.search(request, set().union(*GROUPS.values()), frozenset(), 1, floor))
        except Exception:
            return None
        if not close:
            return None
        return await self._answer_from_knowledge(SimpleNamespace(topic="experience_center"), request, probe=True)

    async def _answer_from_knowledge(self, plan, request: str, probe: bool = False, force_more: bool = False) -> str | None:
        """Answer a knowledge question aloud. `probe`: say nothing and return None unless it is a real answer.
        `force_more`: the visitor asked for more of the last answer ("tell me more"), whatever the rewrite call makes of it.

        Order: restate the question only if it needs it (nlu/query_rewrite.needs_rewrite), search with that query, and only when the search finds
        nothing go to the fallback (the relevance gate, then "I don't have that detail"). When it finds something, the model answers as plain text
        and each sentence is checked and spoken as it arrives (`_speak_answer`)."""
        cfg = load_api_config()
        history = self._recent_history()
        self._new_conversation_check()
        loop = asyncio.get_running_loop()
        self._kb_ok = False
        info: dict = {}
        spoken_text: str | None = None
        try:
            if needs_rewrite(request, history):
                rw = await rewrite_question(self._llm, request, history, plan.topic)
                wants_more, query, topic = rw.wants_more or (force_more and bool(history)), rw.query, rw.topic
                if force_more and not rw.query.strip():
                    query = request
                info["rewrite"] = "ran"
            else:  # nothing to resolve: the transcript is the query, the planner's topic is the topic
                wants_more, query, topic = force_more and bool(history), request, _FROM_PLANNER.get(plan.topic, "company")
                info["rewrite"] = "skipped"
            asks_contact = asks_for_contact(request, query)
            info.update(query=query, wants_more=wants_more, topic=topic)
            groups = GROUPS.get("experience_center" if topic == "place" else topic, set().union(*GROUPS.values()))
            k = int(cfg.get("knowledge_chunks", 3))
            # "Tell me more" names no subject, so no section can score well against it: the next unused sections of the group are the answer.
            floor = 0.0 if wants_more else float(cfg.get("knowledge_min_score", retriever.SECTION_MIN_SCORE))
            boost_groups = None if topic == "place" else groups  # the planner's topic ranks its files higher; it never hides the others
            boost = float(cfg.get("knowledge_topic_boost", TOPIC_BOOST))
            hits = await loop.run_in_executor(None, lambda: retriever.search(
                query, None, self._kb_used if wants_more else frozenset(), k, floor, boost_groups=boost_groups, boost=boost))
            verdict = "no section found"
            info["retrieved"] = [h.label for h in hits]
            first_overview = not self._kb_company_said and not wants_more
            line = str(cfg.get("company_contact_line") or DEFAULT_CONTACT_LINE)
            if hits:
                knowledge = "\n\n".join(f"[{h.label}] {_without_contact_lines(h.text)}" for h in hits)
                threshold = float(cfg.get("knowledge_grounding_min", 0.65))
                if probe:  # not streamed: the model says first whether the knowledge answers; nothing is spoken unless it does
                    spoken, verdict = await self._probe_answer(request, history, knowledge, hits, topic, threshold, info)
                else:
                    messages = [{"role": "system", "content": self._system_prompt}, *history[-6:],
                                {"role": "user", "content": f"{request}\n\nKNOWLEDGE:\n{knowledge}\n\n{RULES}"}]
                    spoken, verdict = await self._speak_answer(messages, knowledge, hits, topic, wants_more, threshold, info, request)
                if spoken:
                    parts = list(spoken)
                    if topic == "company" and (asks_contact or first_overview):
                        parts.append(line)  # the first overview, or a question about reaching them: added by code, after the last sentence
                        await self._say(line)
                    spoken_text = " ".join(parts)
            if spoken_text is None:
                if asks_contact and topic == "company":
                    spoken_text, info["verdict"], self._kb_ok = line, "contact line", True  # "how can I contact them": the line is the whole answer
                    await self._say(line)
                else:
                    info["verdict"] = verdict
                    if probe:
                        return None
                    declined = None if wants_more else await self._decline_if_off_topic(query, request, history)
                    if declined is not None:
                        info["verdict"] = "declined: not about the company, the CMS, Travis or this place"
                        text = declined
                    else:
                        text = ("That's all I have on that." if wants_more and self._kb_used else "I don't have that detail.") + await self._topic_offer(
                            query, groups, {h.chunk_id for h in hits})
                    spoken_text = text
                    self._path = "declined (off topic)" if self._off_topic else "knowledge"
                    if not self._off_topic:
                        self._calls_log.append({"name": "knowledge_search", "args": {"query": query}, "ok": self._kb_ok, "message": info.get("verdict", "")})
                    if isinstance(getattr(self, "_plan_log", None), dict):
                        self._plan_log.update({"knowledge": info})
                    await self._say(text)
                    return text
            info.setdefault("verdict", verdict if hits and spoken_text else "answered")
        except Exception as e:
            print(f"[Voice Agent] ⚠️ Knowledge lookup failed: {e}")
            if probe:
                return None
            text, info = "I can't look that up right now.", {**info, "verdict": f"unavailable: {e}"}
            self._path = "knowledge"
            if isinstance(getattr(self, "_plan_log", None), dict):
                self._plan_log.update({"knowledge": info})
            await self._say(text)
            return text
        self._path = "knowledge"
        self._calls_log.append({"name": "knowledge_search", "args": {"query": query}, "ok": self._kb_ok, "message": info.get("verdict", "")})
        if isinstance(getattr(self, "_plan_log", None), dict):
            self._plan_log.update({"knowledge": info})
        return spoken_text

    def _mark_answered(self, hits, topic: str) -> None:
        """The first sentence really said: these sections count as used, and the answer counts."""
        self._kb_used = self._kb_used | {h.chunk_id for h in hits}
        if topic == "company":
            self._kb_company_said = True
            self._company_answers += 1
        self._kb_last_topic = "experience_center" if topic == "place" else topic
        self._kb_ok = True

    async def _probe_answer(self, request: str, history: list[dict], knowledge: str, hits, topic: str, threshold: float, info: dict) -> tuple[list[str], str]:
        """The old strict form, for `_probe_knowledge` only: JSON {found, answer}, the whole answer checked (grounding at the usual threshold, and no name or
        number the knowledge does not contain), then said. ([the answer], why) or ([], why not): nothing is said unless it is a real answer."""
        messages = [{"role": "system", "content": self._system_prompt}, *history[-6:],
                    {"role": "user", "content": f"{request}\n\nKNOWLEDGE:\n{knowledge}\n\n{RULES_JSON}"}]
        raw = await self._llm.complete_json(messages, ANSWER_SCHEMA, max_tokens=300)
        self._timing.setdefault("llm_first_token", time.monotonic())
        try:
            d = json.loads(raw)
            found, text = bool(d.get("found")), without_contact(str(d.get("answer") or "").strip())
        except (ValueError, AttributeError):
            found, text = False, ""
        if not found or not text:
            return [], "the knowledge does not say"
        ground = round(grounding(text, knowledge), 2)
        info.update(grounding=[ground], sentences=1)
        unknown = unsupported_facts(text, knowledge, request)
        if ground < threshold or unknown:
            return [], "words not in the knowledge" if ground < threshold else f"name or number not in the knowledge: {', '.join(unknown)}"
        self._mark_answered(hits, topic)
        await self._say(text)
        return [text], "answered"

    async def _speak_answer(self, messages: list[dict], knowledge: str, hits, topic: str, wants_more: bool, threshold: float, info: dict, question: str = "") -> tuple[list[str], str]:
        """Stream the model's structured answer and speak it one sentence at a time. (the sentences spoken, why it stopped.)

        The model says `found` first (nlu/json_answer.py): false stops generation and nothing is said. Otherwise each sentence (one shorter than MIN_WORDS
        joins the next, unless it is the last) has contact sentences removed and is checked against the retrieved knowledge at the usual grounding threshold
        BEFORE it is spoken. The visitor's own words count as known when scoring, except in a sentence that denies something, and names and numbers
        must be in the knowledge whatever the score (so "did you win a Nobel Prize" is never confirmed by echoing it back). If the first sentence fails,
        nothing was said and the caller falls back; if a later one fails, generation is cancelled and the rest is not spoken. Sections count as used
        from the first sentence."""
        spoken: list[str] = []
        grounds: list[float] = []
        blocked: list[list[str]] = []
        verdict = "answered"
        splitter, pending, parser = SentenceSplitter(), "", AnswerStream()
        stream = self._llm.stream_text(messages, max_tokens=320, schema=ANSWER_SCHEMA)

        async def speak(unit: str) -> bool:
            """Check one unit and say it; False = stop here."""
            nonlocal verdict
            raw = without_contact(unit)
            if not raw:
                return True
            g, unknown = check_sentence(raw, knowledge, question)  # scored as written...
            text = say_names(raw)  # ...but kept, remembered and spoken the way Travis says names: "The White Tusker" -> "White Tusker", tusker edge -> cove light
            g = round(g, 2)
            grounds.append(g)
            if unknown:
                blocked.append(unknown)
            if g < threshold or unknown:
                why = "words not in the knowledge" if g < threshold else f"name or number not in the knowledge: {', '.join(unknown)}"
                verdict = why if not spoken else f"cut after {len(spoken)} sentence(s): the next was not grounded ({why})"
                return False
            if not spoken:  # the first sentence that is really said
                self._mark_answered(hits, topic)
            spoken.append(text)
            await self._say(text)
            return True

        keep_going = True
        try:
            async for chunk in stream:
                self._timing.setdefault("llm_first_token", time.monotonic())
                new_text = parser.feed(chunk)
                if parser.found is False:
                    verdict, keep_going = "the knowledge does not say", False
                    break
                for sentence in splitter.feed(new_text):
                    pending = f"{pending} {sentence}".strip()
                    if word_count(pending) < MIN_WORDS:
                        continue  # too short to check on its own: it waits for the next sentence
                    unit, pending = pending, ""
                    if not await speak(unit):
                        keep_going = False
                        break
                if not keep_going:
                    break
            if keep_going:
                if parser.found is not True:
                    verdict, keep_going = "the knowledge does not say", False
                else:
                    for sentence in splitter.finish():
                        pending = f"{pending} {sentence}".strip()
                    if pending and not await speak(pending):  # the last unit may be short
                        keep_going = False
        except LocalLLMError as e:
            verdict = f"unavailable: {e}"
            if not spoken:
                raise
        finally:
            await stream.aclose()  # stops Ollama generating if we left early
        info.update(grounding=grounds, sentences=len(spoken), found=parser.found, **({"blocked_facts": blocked} if blocked else {}))
        if not spoken and verdict == "answered":
            verdict = "the knowledge does not say"
        return spoken, verdict

    async def _decline_if_off_topic(self, query: str, request: str, history: list[dict]) -> str | None:
        """The polite refusal if a question with no answer in the knowledge is not about the company, the CMS, Travis or this place at all
        ("Who is the CEO of Google?"), else None. The planner reads any "who / what is" as a question about us; the relevance gate (the
        same one that guards every other request) is what tells "who founded the studio" (ours, just not in the file) from the rest."""
        review = await self._gate.review(query, history)
        self._timing["gate_done"] = time.monotonic()
        if review.allowed:
            return None
        print(f"[Voice Agent] 🚧 Off topic — declining: {request!r}")
        self._off_topic = True
        # One or two words ("I won") is a mishearing, not an off-topic request.
        return "Sorry, I didn't catch that." if len(request.split()) <= 2 else self._decline_text()

    async def _topic_offer(self, query: str, groups: set[str], skip: set[str]) -> str:
        """" I can tell you about our clients or where we are if you like.": up to two sections that exist and have not been used,
        the closest to the question first, named the way the knowledge file says (<!-- say: our clients -->)."""
        try:
            fresh = await asyncio.get_running_loop().run_in_executor(
                None, lambda: retriever.search(query, groups, self._kb_used | skip, 2, 0.0))
        except Exception:
            return ""
        topics = [h.topic for h in fresh if h.topic and h.topic != "overview"]
        return f" I can tell you about {' or '.join(topics)} if you like." if topics else ""
