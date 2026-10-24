"""FAQ and small-talk answers that are written down (knowledge/faq.yaml, knowledge/smalltalk.yaml), and the matcher that finds them.

A visitor's sentence is matched to the VARIANTS of an entry (how people actually ask), by local embeddings (nomic-embed-text) blended with a
fuzzy string match. It is accepted only when ALL of these hold:

    * the sentence has no action word (turn, switch, set, play, ...) and names no device: a command is never taken for a question
    * the best entry scores at least `threshold`, and beats the next entry by at least `margin`
    * the question word agrees with the entry (nlu/faq_question_type.py): "When was White Tusker founded" never gets the founders answer

Only entries whose `status` is in `statuses` (default: approved) are used. Nothing is written here: an answer is exactly the text in the file,
plus, for add_email_line entries, the existing contact line that code adds.
"""

from __future__ import annotations

import difflib
import hashlib
import random
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np
import yaml

from nlu.faq_question_type import compatible

ACTION_WORDS = frozenset(
    "turn switch set play open close lock unlock increase decrease mute unmute start stop show".split()
)
APPROVED = ("approved", "approve")
_ASKING_WORDS = frozenset("what whats how why where who when which can could would will do does is are tell show explain".split())
_REPLY_ONLY_MAX_WORDS = 7
_FILLER = re.compile(r"\b(please|hey travis|travis|ok|okay|so|um|uh|can you|could you|would you|kindly)\b")


@dataclass
class Entry:
    id: str
    kind: str  # faq | no_info | smalltalk
    topic: str
    variants: list[str]
    answers: list[str]
    question_type: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    next_sections: list[str] = field(default_factory=list)
    add_email_line: bool = False
    offers: str = ""
    status: str = "draft"
    intent: str = ""  # small talk: greeting, joke, ...
    reply_only: bool = False  # answers a feeling ("I'm good"): never taken when the sentence also asks or requests something ("good thanks, what can you do")


@dataclass
class Match:
    entry: Entry
    score: float
    margin: float
    variant: str


def normalise(text: str) -> str:
    t = re.sub(r"[^a-z0-9' ]+", " ", (text or "").lower().replace("’", "'"))
    return " ".join(_FILLER.sub(" ", t).split())


def load_entries(faq_path: Path, smalltalk_path: Path | None = None, statuses: tuple[str, ...] = APPROVED) -> list[Entry]:
    """Every FAQ, no_info and small-talk entry whose status is in `statuses`. A missing file is no entries."""
    want = {s.lower() for s in statuses}
    out: list[Entry] = []

    def read(path: Path | None) -> dict:
        if path is None or not Path(path).exists():
            return {}
        return yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}

    faq = read(faq_path)
    for key, kind in (("entries", "faq"), ("no_info", "no_info")):
        for e in faq.get(key) or []:
            if str(e.get("status", "draft")).lower() in want:
                out.append(Entry(
                    id=e["id"], kind=kind, topic=e.get("topic", ""), variants=list(e.get("variants") or []), answers=[str(e["answer"])],
                    question_type=list(e.get("question_type") or []), sources=list(e.get("sources") or []),
                    next_sections=list(e.get("next_sections") or []), add_email_line=bool(e.get("add_email_line")),
                    offers=str(e.get("offers") or ""), status=str(e.get("status")),
                ))
    for e in read(smalltalk_path).get("intents") or []:
        if str(e.get("status", "draft")).lower() in want:
            out.append(Entry(
                id=e["id"], kind="smalltalk", topic="smalltalk", variants=list(e.get("variants") or []),
                answers=[str(a) for a in (e.get("answers") or [])], status=str(e.get("status")), intent=e["id"],
                reply_only=bool(e.get("reply_only", False)),
            ))
    return out


def _fuzzy(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    sa, sb = set(a.split()), set(b.split())
    token = len(sa & sb) / max(len(sa | sb), 1)
    return max(difflib.SequenceMatcher(None, a, b).ratio(), token)


class CannedMatcher:
    """`embed(texts) -> (N, D) float32 matrix, rows normalised` (the local Ollama embedder in production, a fake in tests)."""

    # Chosen from numbers (docs/FAQ_REVIEW.md, "Matching thresholds"): 327 held-out variants, 462 non-FAQ sentences (all bench device commands + logged ones)
    def __init__(self, entries: list[Entry], embed: Callable[[list[str]], np.ndarray], threshold: float = 0.82, margin: float = 0.04,
                 embed_weight: float = 1.0, min_fuzzy: float = 0.4, cache_path: Path | None = None):
        self.entries = entries
        self._embed = embed
        self.threshold, self.margin, self.embed_weight, self.min_fuzzy = threshold, margin, embed_weight, min_fuzzy
        self._rows: list[tuple[int, str, str]] = [(i, v, normalise(v)) for i, e in enumerate(entries) for v in e.variants]
        self._matrix = self._build(cache_path)

    def _build(self, cache_path: Path | None) -> np.ndarray:
        texts = [r[1] for r in self._rows]
        if not texts:
            return np.zeros((0, 1), dtype=np.float32)
        key = hashlib.sha256("\n".join(texts).encode("utf-8")).hexdigest()
        if cache_path is not None and Path(cache_path).exists():
            try:
                with np.load(cache_path, allow_pickle=False) as d:
                    if str(d["key"]) == key:
                        return np.asarray(d["vectors"], dtype=np.float32)
            except Exception:
                pass
        mat = np.asarray(self._embed(texts), dtype=np.float32)
        if cache_path is not None:
            try:
                Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
                np.savez(cache_path, key=np.array(key), vectors=mat)
            except OSError:
                pass
        return mat

    def scores(self, text: str, skip_incompatible: bool = True) -> list[tuple[float, int, str]]:
        """Per entry, best first: (score, entry index, best variant). Entries whose question type conflicts are left out."""
        if not self._rows:
            return []
        q = np.asarray(self._embed([text]), dtype=np.float32)[0]
        sims = self._matrix @ q
        nt = normalise(text)
        best: dict[int, tuple[float, str]] = {}
        for (ei, variant, nv), cos in zip(self._rows, sims):
            s = self.embed_weight * float(cos) + (1 - self.embed_weight) * _fuzzy(nt, nv)
            if ei not in best or s > best[ei][0]:
                best[ei] = (s, variant)
        ranked = sorted(((s, ei, v) for ei, (s, v) in best.items()), reverse=True)
        if skip_incompatible:
            ranked = [r for r in ranked if compatible(text, self.entries[r[1]].question_type if self.entries[r[1]].kind != "smalltalk" else None)]
        return ranked

    def match(self, text: str, device_words=()) -> Match | None:
        words = set(re.findall(r"[a-z']+", (text or "").lower()))
        low = (text or "").lower()
        if not words or words & ACTION_WORDS or any(d and d.lower() in low for d in device_words):
            return None
        ranked = self.scores(text)
        if not ranked:
            return None
        top = ranked[0]
        second = ranked[1][0] if len(ranked) > 1 else 0.0
        if top[0] < self.threshold or top[0] - second < self.margin:
            return None
        if self.entries[top[1]].reply_only and (words & _ASKING_WORDS or len(words) > _REPLY_ONLY_MAX_WORDS):
            return None  # a feeling plus a question or request goes on to the planner, which answers the rest
        if _fuzzy(normalise(text), normalise(top[2])) < self.min_fuzzy:  # close in meaning but sharing almost no words: not a rewording of this entry
            return None
        return Match(self.entries[top[1]], top[0], top[0] - second, top[2])


def pick_answer(entry: Entry, last: dict[str, str], used: set[str], rng: random.Random | None = None) -> str:
    """One of the entry's answers: never the one just given for this entry; for jokes never one already told in this session
    (when every joke has been told, the cycle starts over)."""
    rng = rng or random
    options = list(entry.answers)
    if entry.intent == "joke":
        fresh = [a for a in options if a not in used]
        if not fresh:
            used.clear()
            fresh = options
        options = fresh
    elif len(options) > 1:
        options = [a for a in options if a != last.get(entry.id)] or options
    answer = rng.choice(options)
    last[entry.id] = answer
    if entry.intent == "joke":
        used.add(answer)
    return answer


def embedder_from_ollama() -> Callable[[list[str]], np.ndarray]:
    """The local nomic-embed-text, with the query prefix on both sides (the sentences are compared with each other, not with documents)."""
    from rag import indexer

    def embed(texts: list[str]) -> np.ndarray:
        return indexer.embed_texts(list(texts), "RETRIEVAL_QUERY")

    return embed


__all__ = ["Entry", "Match", "CannedMatcher", "load_entries", "pick_answer", "embedder_from_ollama", "normalise", "ACTION_WORDS"]
