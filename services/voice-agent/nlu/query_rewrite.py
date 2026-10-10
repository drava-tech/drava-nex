"""A visitor's question restated on its own, for the knowledge search.

"Tell me more about it" means nothing to a search; "more about White Tusker" does. After the planner (nlu/planner.py) has decided a request
is a question about the company, the CMS, Travis or this place, one small structured call turns it into:

    query         the question restated on its own, "it" / "their" replaced by the real subject (using the conversation so far)
    topic         company | cms | travis | place   (which sections to search)
    wants_more    asks for more of what was just said, with no new subject ("tell me more", "what else")

This is a SEPARATE call on purpose. These fields were tried inside the planner's own output, and the extra prompt text changed how the planner
read device commands ("Set the AC to 22, actually don't", "What's two plus two and turn off <light>"): a device command must never be affected by
the question machinery, so it never sees this prompt and never pays for this call.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

SYSTEM = """You turn a visitor's latest message into ONE standalone search query for a small knowledge base about White Tusker (a brand experience design studio), the CMS platform it builds, and Travis (the voice assistant). Use the earlier conversation to replace words like it, they, their, them, that, there with the real subject. Do not answer.
topic: "company" (White Tusker), "cms", "travis", or "place" (this room / experience center).
wants_more: true ONLY when the visitor asks for more of what was just said, with no new subject ("tell me more", "what else", "go on", "anything else"). A NEW question about a part of the subject ("what about their prices", "who founded it") is false.
Examples (a different subject, to show the pattern):
Earlier: Visitor: tell me about the bakery / Travis: The bakery makes bread and cakes.  Latest: what about their prices -> {"query":"the bakery prices","topic":"company","wants_more":false}
Earlier: Visitor: tell me about the bakery / Travis: The bakery makes bread and cakes.  Latest: tell me more about it -> {"query":"more about the bakery","topic":"company","wants_more":true}
Earlier: (nothing)  Latest: how do I reach them -> {"query":"how to contact the bakery","topic":"company","wants_more":false}
Reply as JSON: {"query": string, "topic": string, "wants_more": boolean}. Take the subject from the conversation (White Tusker, the CMS, or Travis); only when the conversation names none, it is White Tusker."""

SCHEMA = {
    "type": "object",
    "properties": {
        "query": {"type": "string"},
        "topic": {"type": "string", "enum": ["company", "cms", "travis", "place"]},
        "wants_more": {"type": "boolean"},
    },
    "required": ["query", "topic", "wants_more"],
}
# The planner's own topic names -> the ones used here
_FROM_PLANNER = {"company": "company", "cms": "cms", "travis": "travis", "experience_center": "place"}

# The rewrite is only worth its ~0.5 s when there is something to resolve: words that point back at the conversation, or a fragment too short to
# search on its own. Any other question is searched as it was heard.
CONTEXT_WORDS = frozenset("it that they this them more else also their there".split())
SHORT_WORDS = 3
_CONTACT_WORDS = re.compile(r"\b(?:contact|e-?mail|reach|address|phone)\b|\bwhere\s+are\s+you\b", re.I)


def needs_rewrite(message: str, history: list[dict]) -> bool:
    """History is not empty AND the question has a context word or is `SHORT_WORDS` words or fewer."""
    if not history:
        return False
    words = re.findall(r"[a-z0-9']+", (message or "").lower())
    return len(words) <= SHORT_WORDS or bool(CONTEXT_WORDS & set(words))


def asks_for_contact(*texts: str) -> bool:
    """Asks how to reach the company, its email or phone, or where it is: a keyword check, no model."""
    return any(_CONTACT_WORDS.search(t or "") for t in texts)


@dataclass
class Rewrite:
    query: str
    topic: str  # company | cms | travis | place
    wants_more: bool = False


async def rewrite_question(llm, message: str, history: list[dict], planner_topic: str = "company") -> Rewrite:
    """The question restated, with its flags. Falls back to the message itself and the planner's topic if the model's answer is unusable."""
    said = "\n".join(f"{'Visitor' if m['role'] == 'user' else 'Travis'}: {m['content']}" for m in history[-4:]) or "(nothing yet)"
    fallback = Rewrite(message, _FROM_PLANNER.get(planner_topic, "company"))
    try:
        raw = await llm.complete_json([{"role": "system", "content": SYSTEM}, {"role": "user", "content": f"Earlier:\n{said}\n\nLatest: {message}"}], SCHEMA, max_tokens=140)
        d = json.loads(raw)
        if not isinstance(d["query"], str):
            raise TypeError("query must be text")
        out = Rewrite(d["query"].strip() or message, d["topic"] if d.get("topic") in _FROM_PLANNER.values() else fallback.topic,
                      bool(d.get("wants_more")))
    except (ValueError, KeyError, TypeError, AttributeError):
        return fallback
    if not any(m["role"] == "assistant" for m in history):  # nothing was said yet, so there is nothing to ask "more" of
        out.wants_more = False
    return out
