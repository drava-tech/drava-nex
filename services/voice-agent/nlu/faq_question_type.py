"""The question word of a visitor's question, and whether an FAQ entry may answer it.

Embeddings cannot tell "Who founded White Tusker" (answered) from "When was White Tusker founded" (not in the knowledge): one word
apart, 0.96 similar. So a match is also checked on the question word: each entry in knowledge/faq.yaml lists the `question_type`s its
variants use, and an entry whose types do not include the utterance's type is rejected, however close it scored.

Types: who, when, where, what, how_many, how. A question that names none ("Founders", "Tell me about your team", "Can you hear me") has
type None, and no entry is rejected for it. "which" counts as "what". A question word further in than the first few words is ignored
("Tell me about the day we met" has no "when").
"""

from __future__ import annotations

import re

# Checked in this order at the same position; the earliest match in the text wins.
_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("how_many", re.compile(r"\bhow (?:many|much)\b")),
    ("when", re.compile(r"\b(?:in )?(?:which|what) (?:year|date|month)\b|\bsince when\b|\bwhen\b")),
    ("how", re.compile(r"\bhow\b")),
    ("who", re.compile(r"\b(?:who|whom|whose)\b")),
    ("where", re.compile(r"\bwhere\b|\bin which (?:city|place|area)\b")),
    ("what", re.compile(r"\b(?:what|which)\b")),
]
_LEADING_WORDS = 6  # a question word after this many words is part of a statement, not the question


def question_type(text: str) -> str | None:
    """"who" / "when" / "where" / "what" / "how_many" / "how", or None if the text names no question word near its start."""
    words = re.findall(r"[a-z']+", (text or "").lower())
    head = " ".join(words[:_LEADING_WORDS + 3])
    best: tuple[int, str] | None = None
    for kind, pattern in _PATTERNS:
        m = pattern.search(head)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), kind)
    if best is None:
        return None
    # "Tell me when..." is fine; "Can you tell me about the company when" is not: the word must be within the first words.
    if len(head[:best[0]].split()) > _LEADING_WORDS:
        return None
    return best[1]


def compatible(utterance: str, accepted: list[str] | tuple[str, ...] | None) -> bool:
    """False only when the utterance has a question word and the entry's `question_type` list does not include it.
    An entry with no list (or an utterance with no question word) is never rejected."""
    kind = question_type(utterance)
    return kind is None or not accepted or kind in accepted
