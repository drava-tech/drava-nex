"""Sounds-like name suggestions, and the yes/no that confirms one.

A name said aloud is rarely what the CMS has: Whisper hears "mountain flows" for "Mountain Flow",
"lobi loop" for "Lobby Loop", "tusker edje" for a light. When the CMS finds nothing for what was
said (a title, screen, device or mode), Travis suggests the closest REAL names, one at a time, and
acts only after "Hey Travis, yes". Nothing is invented: a suggestion is always a name from the CMS
(or commands.json) lists, and the call is made only on that yes.

Public API:
    suggest(spoken, titles) -> [(title, score)]   best first, only plausible ones
    Candidate, Confirm                             what is being asked and what it would push
    question(confirm, wake_hint) -> str            the spoken question for the current candidate
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field

from nlu.command_matcher import normalize, similarity

MIN_SCORE = 0.6  # below this the title is not "similar sounding" — better to list nothing than guess
TTL_SEC = 45.0  # same as nlu/pending.py: long enough to say "Hey Travis" again
MAX_ASKED = 2  # the first guess, and one more after a no; then the user is asked to repeat

_ARTICLES = {"the", "a", "an", "of"}


def _sounds(word: str) -> str:
    """A rough spelling-independent key: "tuscar" and "tusker" both become "taskar"."""
    w = word.lower()
    for pat, rep in (
        (r"ph", "f"), (r"ck", "k"), (r"c(?=[eiy])", "s"), (r"[cq]", "k"), (r"x", "ks"), (r"z", "s"),
        (r"^wh", "w"), (r"^kn", "n"), (r"^wr", "r"), (r"gh", ""), (r"[aeiouy]+", "a"), (r"(.)\1+", r"\1"),
    ):
        w = re.sub(pat, rep, w)
    return w


def _tokens(text: str) -> list[str]:
    return [t for t in normalize(text).split() if t not in _ARTICLES]


def _word_sim(a: str, b: str) -> float:
    da, db = re.findall(r"\d+", a), re.findall(r"\d+", b)
    if da or db:
        if da != db:
            return 0.0  # "86" is never "87", and "L9" is never "L1"
        if a.isdigit() and b.isdigit():
            return 1.0
    return max(similarity(a, b), similarity(_sounds(a), _sounds(b)))


def _overlap(spoken: list[str], title: list[str]) -> float:
    """How well each spoken word is found in the title and each title word in the speech
    (words Whisper dropped or added cost a little, wrong words cost more)."""
    if not spoken or not title:
        return 0.0
    heard = sum(max(_word_sim(s, t) for t in title) for s in spoken) / len(spoken)
    covered = sum(max(_word_sim(s, t) for s in spoken) for t in title) / len(title)
    return (heard + covered) / 2


def score(spoken: str, title: str) -> float:
    s, t = _tokens(spoken), _tokens(title)
    if not s or not t:
        return 0.0
    nums_s, nums_t = re.findall(r"\d+", " ".join(s)), re.findall(r"\d+", " ".join(t))
    if nums_s != nums_t:
        # "Welcome Reel 2025" is not "Welcome Reel 2024", and "tusker L9" is neither "tusker L1" nor
        # "tusker edge": a number said (or missing) is never smoothed over.
        return 0.0
    whole = max(similarity(" ".join(s), " ".join(t)), similarity(_sounds("".join(s)), _sounds("".join(t))))
    return max(whole, _overlap(s, t))


def suggest(spoken: str, titles: list[str], limit: int = MAX_ASKED, min_score: float = MIN_SCORE) -> list[tuple[str, float]]:
    seen: set[str] = set()
    scored = []
    for title in titles:
        if not title or title in seen:
            continue
        seen.add(title)
        sc = score(spoken, title)
        if sc >= min_score:
            scored.append((title, round(sc, 3)))
    return sorted(scored, key=lambda x: -x[1])[:limit]


@dataclass
class Candidate:
    """One real name to offer, and the call that makes it happen if the user says yes."""

    kind: str  # as spoken: "experience", "media item", "screen", "device", "mode"
    title: str
    score: float
    tool: str
    args: dict


@dataclass
class Confirm:
    """The name Travis is asking about: yes makes the candidate's call, no offers the next one."""

    candidates: list[Candidate]
    spoken: str
    index: int = 0
    expires: float = field(default_factory=lambda: time.monotonic() + TTL_SEC)

    @property
    def fresh(self) -> bool:
        return time.monotonic() < self.expires

    @property
    def current(self) -> Candidate | None:
        return self.candidates[self.index] if self.index < len(self.candidates) else None

    def next(self) -> Candidate | None:
        self.index += 1
        self.expires = time.monotonic() + TTL_SEC
        return self.current


def question(c: Confirm, wake_hint: str, first: bool = True) -> str:
    cand = c.current
    assert cand is not None
    lead = "I couldn't find that exactly." if first else "Okay."
    ask = f"Did you mean {cand.title}, the {cand.kind}?" if first else f"How about {cand.title}, the {cand.kind}?"
    return f"{lead} {ask} Say {wake_hint}, yes or no."
