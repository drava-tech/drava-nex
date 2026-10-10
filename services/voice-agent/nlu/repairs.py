"""Self-corrections: "set the AC to 24, no wait, 22" / "turn on, I mean turn off, tusker edge".

When someone corrects themselves, the last version is what they mean. This only finds the
marker and the words after it; whether those words stand alone as a command is for the
caller to check. If they don't ("no wait 22" is only a value), the whole sentence goes to
the language model, which is told that the last version wins.

Public API:
    has_marker(text) -> bool
    last_version(text) -> str | None     the words after the last marker, if there are enough
"""

from __future__ import annotations

import re

_MARKER = re.compile(
    r"(?:\b(?:no wait|wait no|no no|no sorry|i mean|i meant|sorry|scratch that|make that|actually|or rather|rather|hold on|wait)\b"
    r"|,\s*no\b(?!\s+(?:wait|sorry|no)\b))[\s,]*",
    re.I,
)
MIN_WORDS = 2

# "Turn the, what do you call it, tusker L1 on": the "it" there is a hesitation, not a pronoun.
_HESITATION = re.compile(
    r"\b(?:what do you call (?:it|that|this)|what(?:'s| is| was) (?:it|that) called|what was it|what is it|what's it|"
    r"how do you say|you know|or something|or whatever|kind of|sort of|i guess|let me think|let me see)\b[\s,]*",
    re.I,
)


def strip_hesitations(text: str) -> str:
    cleaned = _HESITATION.sub("", text or "")
    return re.sub(r"\s+([,.?!])", r"\1", re.sub(r"\s{2,}", " ", cleaned)).strip(" ,")


def split_correction(text: str) -> tuple[str, str] | None:
    """(what they said first, what they corrected it to) for the LAST marker, or None."""
    pieces = [p for p in _MARKER.split(text or "") if p.strip(" .,?!")]
    if len(pieces) < 2:
        return None
    before, after = pieces[-2].strip(" .,?!"), pieces[-1].strip(" .,?!")
    before = re.sub(r"[\s,]*\b(?:or|and|but)\s*$", "", before, flags=re.I)  # "..., or actually ..."
    return (before, after) if before and after else None


# How a self-correction is passed to the planner: "<first version> (they corrected themselves: <fix>. Do only ...)"
CORRECTION_NOTE = " (they corrected themselves: {fix}. Do only the corrected request.)"
CORRECTION_NOTE_START = "(they corrected themselves"


def has_marker(text: str) -> bool:
    return bool(_MARKER.search(text or ""))


_CANCEL = (("never", "mind"), ("nevermind",), ("forget", "it"), ("cancel", "that"), ("scratch", "that"), ("ignore", "that"), ("leave", "it"))


def is_cancel(text: str) -> bool:
    """"Forget it, I'll do it later": starts with a cancel phrase, whatever follows."""
    words = re.findall(r"[a-z]+", (text or "").lower())
    words = [w for w in words if w not in {"um", "uh", "er", "erm", "oh", "okay", "ok", "well", "so", "hey", "travis"}]
    return any(tuple(words[: len(c)]) == c for c in _CANCEL)


_TRAILING_STOP = re.compile(r"[,.;]\s*stop[\s.!?]*$", re.I)


def ends_with_stop(text: str) -> bool:
    """"Turn on tusker edge, stop": a closing "stop" after something else cancels it. A bare
    "stop" is still the CMS Stop command, so something real has to come before it."""
    m = _TRAILING_STOP.search(text or "")
    return bool(m) and len(re.findall(r"[a-z]+", (text or "")[: m.start()].lower())) >= 2


def last_version(text: str) -> str | None:
    pieces = [p for p in _MARKER.split(text or "") if p.strip(" .,?!")]
    if len(pieces) < 2:
        # "Hold on, turn on tusker edge": a marker that only opens the sentence. What follows
        # it is the request; there is no earlier version being replaced.
        rest, opened = (text or "").strip(), False
        while (lead := _MARKER.match(rest)) and lead.end() > 0:  # "hold on, wait, ..."
            rest, opened = rest[lead.end():].strip(" .,?!"), True
        return rest if opened and len(rest.split()) >= MIN_WORDS else None
    tail = pieces[-1].strip(" .,?!")
    return tail if len(tail.split()) >= MIN_WORDS else None


# Two or more negatives in a row take the request back: "no, no", "nahi nahi" (Hindi), "nahin nahin", "nai nai", "na na", "nako nako" (Marathi). A single one
# can be part of a sentence, or a tag question ("... na?"), so it never cancels on its own. Closers: "never mind", "forget it", "cancel that", "scratch that",
# "ignore that", and the Hindi "rehne do" / "chhod do" ("leave it").
_NEG = r"(?:no|nope|nah|nahi|nahin|nai|na|nako)"
_TRAILING_NO = re.compile(
    rf"[,.;!?\s]({_NEG}[,.;!?\s]+){{1,}}{_NEG}[\s.!?]*$"
    r"|[,.;!?\s](?:never\s*mind|forget\s+it|cancel\s+that|scratch\s+that|ignore\s+that|rehne\s+do|chh?od\s+do)[\s.!?]*$",
    re.I,
)


def ends_with_retraction(text: str) -> bool:
    """"Tell me about yourself. No, no, no.": the speaker takes the request back at the end of the sentence. Two or more "no"s in a row (a single "no"
    can be part of a sentence), or a closing "never mind" / "forget it" / "cancel that", after at least two other words."""
    t = text or ""
    m = _TRAILING_NO.search(t)
    return bool(m) and len(re.findall(r"[a-z]+", t[: m.start()].lower())) >= 2
