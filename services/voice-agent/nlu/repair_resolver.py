"""Self-repair: a request that takes itself back, corrects itself, or is phrased as a tag question.

    "Tell me about yourself. No"            -> a tag on an information question: it means "please tell me"
    "Tell me about yourself, no?" / "...na" -> a tag question (Indian English): it means "please tell me", NOT cancel
    "Turn on the lights, scratch that"      -> cancel
    "Turn on the lights, actually the fan"  -> a correction: act on "Turn on the fan"
    "ok wait, the other screen"             -> a correction of the PREVIOUS request

Cheapest first, so a normal turn pays nothing and a cue turn pays as little as possible:

  1. `needs_resolver(text)`   one synchronous regex (microseconds). No cue in the text: nothing below runs and no model is called.
  2. `tag_split(text)`        tag questions are removed IN CODE ("..., no?", "...na", "..., right?", "..., isn't it", "...yaar"). No model call.
  3. `compose_correction()`   a correction with a marker ("actually", "I mean", "no wait") is composed in code from `repairs.split_correction`
                              when the pieces allow it ("Turn on the lights" + "the fan").
  4. `RepairResolver.classify()`  only what code could not decide goes to the local Qwen: ONE small structured call, kind + confidence only
                              (none | cancel | correction | unclear), thinking off, temperature 0, ~14 output tokens. Hard timeout.
  5. `RepairResolver.rewrite()`    only for a correction that step 3 could not compose: the corrected request, 1 s limit. A rewrite identical to the
                              input is ignored, and every content word must have been said (now, or in the previous request).

Nothing here raises, and nothing here can hang a turn: on timeout, error or output that does not parse, the decision is "none" and the turn goes on
exactly as it would have without this module. The classify and rewrite calls run ALONE (never beside the planner): Ollama serves one request at a
time, so a parallel run only makes the resolver wait behind the planner (measured; see docs/PHASE_REPAIR_RESULTS.md).
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any

from nlu import repairs

KINDS = ("none", "cancel", "correction", "unclear")
CLARIFY = "Sorry, should I stop, or go ahead with that?"

CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {"kind": {"type": "string", "enum": list(KINDS)}, "confidence": {"type": "number"}},
    "required": ["kind", "confidence"],
}
REWRITE_SCHEMA = {"type": "object", "properties": {"resolved_request": {"type": "string"}}, "required": ["resolved_request"]}

CLASSIFY_SYSTEM = """You read one sentence a visitor said to a voice assistant in a room (lights, AC, screens, questions about the studio). Is the speaker repairing it?
none: a normal request or question. "no" as part of the content ("there is no projector here, can you check") is NOT a repair.
cancel: the speaker takes the whole request back ("scratch that", "leave it yaar", "hold on, don't", "oops, not that one").
correction: the speaker replaces part of a request ("actually the fan", "I mean Wednesday", "ok wait, the other screen").
unclear: you cannot tell whether they want it done.
Reply as JSON: {"kind": ..., "confidence": 0 to 1}."""

REWRITE_SYSTEM = """The speaker corrected themselves. Write the complete request with the correction applied, using only the speaker's words and the words of their previous request. If the correction names only a new target ("the other screen"), keep the previous request's action and object.
Reply as JSON: {"resolved_request": "..."}."""

# A repair CUE: a word or phrase that can mean "take back / correct / confirm". Plain requests have none, so they never reach the model.
_CUE = re.compile(
    r"(?<![a-z'])(?:"
    r"no|nope|nah|na|naa|nahi|never\s*mind|forget\s+(?:it|that)|scratch\s+that|ignore\s+that|cancel(?:\s+that)?|leave\s+it|"
    r"actually|i\s+mean|i\s+meant|or\s+rather|rather|instead|sorry|oops|wait|hold\s+on|hang\s+on|don'?t|do\s+not|not\s+that|wrong|"
    r"the\s+other|other\s+one|yaar|isn'?t\s+it|aren'?t\s+you|won'?t\s+you|ok\s+wait|okay\s+wait"
    r")(?![a-z'])|,\s*right\s*\??\s*$",  # (a closing ", right?" is a tag; "turn right" is not)
    re.I,
)


def needs_resolver(text: str) -> bool:
    """True if `text` holds a repair cue. Synchronous, one regex: microseconds. False means no model is ever called for this turn."""
    return bool(text) and _CUE.search(text) is not None


# ── tag questions, in code ───────────────────────────────────────────────

# A tag on the end of a request: ", no?" ", na?" ", right?" ", isn't it" "yaar". With a "?" (or a tag word that only asks for confirmation) it asks for the request itself.
_TAG = re.compile(
    r"[\s,;.]+(?:(?P<q>(?:no|nope|nah|na|naa|right|yaar|isn'?t\s+it|aren'?t\s+you|won'?t\s+you)\s*\?)"
    r"|(?P<n>na|naa|yaar|isn'?t\s+it|right|aren'?t\s+you|won'?t\s+you)|(?P<bare>no|nope|nah))[\s.!?]*$",
    re.I,
)
_ACTION_VERBS = frozenset(
    "turn switch set lock unlock dim brighten raise lower increase decrease mute unmute play pause resume skip open close start stop show push display "
    "make put change adjust blank reset assign queue".split()
)
_LEAD = frozenset("hey travis please can could would will you just ok okay".split())


@dataclass
class TagSplit:
    request: str  # the request without the tag
    certain: bool  # "?" or a tag word that only ever asks for confirmation: do it. A bare trailing "no" is certain only for an information question.


def looks_like_action(text: str) -> bool:
    """A request that would move something in the room (it starts with an action verb, after "can you" / "please" / "hey travis")."""
    words = [w for w in re.findall(r"[a-z']+", (text or "").lower()) if w not in _LEAD]
    return bool(words) and words[0] in _ACTION_VERBS


def tag_split(text: str) -> TagSplit | None:
    """The request without a trailing tag, or None. "Tell me about yourself, no?" -> ("Tell me about yourself", certain). A bare trailing "no"
    ("Tell me about yourself. No") is `certain` only when the request is an information question: before a device action it must be confirmed."""
    t = (text or "").strip()
    m = _TAG.search(t)
    if not m or len(re.findall(r"[a-z]+", t[: m.start()].lower())) < 2:
        return None
    request = t[: m.start()].strip(" ,;.")
    if repairs.is_cancel(request) or repairs.ends_with_retraction(request):
        return None
    if m.group("bare"):
        return TagSplit(request, certain=not looks_like_action(request))
    return TagSplit(request, certain=True)


# ── corrections, in code ─────────────────────────────────────────────────

_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_PARTICLES = {"on", "off", "up", "down", "out", "in", "back"}


def compose_correction(first: str, fix: str) -> str | None:
    """The corrected request, composed from the two halves `repairs.split_correction` found, when the halves allow it:
        number for number    "Set tusker edge to 80" + "60"            -> "Set tusker edge to 60"
        a new object         "Turn on the lights" + "the fan"          -> "Turn on the fan"   (only for a short first half)
    None when it is not clear: the model is asked instead."""
    first, fix = (first or "").strip(" ,.?!"), (fix or "").strip(" ,.?!")
    if not first or not fix:
        return None
    fix_words = re.findall(r"[a-z0-9']+", fix.lower())
    if re.fullmatch(r"\d+(?:\.\d+)?\s*(?:%|percent|degrees?)?", fix.lower()):
        numbers = list(_NUMBER.finditer(first))
        if not numbers:
            return None
        found = _NUMBER.search(fix)
        if found is None:
            return None
        last = numbers[-1]
        return first[: last.start()] + found.group(0) + first[last.end():]
    if fix_words and fix_words[0] in _ACTION_VERBS:
        return None  # a whole new request ("make it 22", "turn off the fan"): the existing correction logic reads it (agent/commands.py), with its context
    first_words = first.split()
    if 2 <= len(first_words) <= 5 and len(fix_words) <= 4 and first_words[0].lower() in _ACTION_VERBS:
        verb = first_words[:2] if len(first_words) > 2 and first_words[1].lower() in _PARTICLES else first_words[:1]
        return " ".join(verb) + " " + fix
    return None


# ── the model ────────────────────────────────────────────────────────────


@dataclass
class RepairDecision:
    kind: str = "none"  # none | cancel | correction | unclear
    resolved_request: str = ""
    confidence: float = 1.0
    source: str = "none"  # rule | tag | split | model | rewrite | timeout | error | unparsed | rejected | none
    ms: float = 0.0
    note: str = ""

    def as_log(self) -> dict:
        return {"kind": self.kind, "confidence": round(self.confidence, 2), "ms": round(self.ms), "source": self.source,
                **({"resolved": self.resolved_request} if self.resolved_request else {}), **({"note": self.note} if self.note else {})}


def deterministic(text: str) -> RepairDecision | None:
    """The rule that needs no model: "no, no, no", a closing or opening "never mind" / "forget it" / "cancel that" / "scratch that" (nlu/repairs.py)."""
    if repairs.ends_with_retraction(text) or repairs.is_cancel(text):
        return RepairDecision("cancel", "", 1.0, "rule")
    return None


_FUNCTION = frozenset("a an the on in at to of for and with it is my".split())


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


def _same(a: str, b: str) -> bool:
    return sorted(_words(a)) == sorted(_words(b))


def honest(resolved: str, said: str, before: str) -> bool:
    """Every content word of the rewrite was said by the visitor (now or in their previous request): it cannot invent a request."""
    return bool(resolved.strip()) and (_words(resolved) - _FUNCTION) <= (_words(said) | _words(before))


@dataclass
class RepairResolver:
    llm: Any  # nlu.local_llm.OllamaChat: created once at startup, shared with the planner (one connection pool, model kept loaded)
    timeout_ms: float = 700.0
    rewrite_timeout_ms: float = 1000.0
    min_confidence: float = 0.6
    stats: list = field(default_factory=list)  # RepairDecision.as_log() of every model call (latency review)

    async def _ask(self, system: str, user: str, schema: dict, tokens: int, timeout_ms: float) -> tuple[str | None, str, float]:
        """(raw reply or None, why it failed, ms). Never raises."""
        started = time.perf_counter()
        try:
            raw = await asyncio.wait_for(
                self.llm.complete_json([{"role": "system", "content": system}, {"role": "user", "content": user}], schema, max_tokens=tokens), timeout_ms / 1000.0)
            return raw, "", (time.perf_counter() - started) * 1000
        except asyncio.TimeoutError:
            return None, "timeout", (time.perf_counter() - started) * 1000
        except asyncio.CancelledError:
            raise
        except Exception:  # the model is down, the request failed: the turn goes on without this module
            return None, "error", (time.perf_counter() - started) * 1000

    @staticmethod
    def _context(last_request: str, last_reply: str, last_action: str = "") -> str:
        bits = []
        if last_request:
            bits.append(f"visitor said \"{last_request}\"")
        if last_action:
            bits.append(f"which did: {last_action}")
        if last_reply:
            bits.append(f"Travis answered \"{last_reply[:160]}\"")
        return f"Previous turn: {'; '.join(bits)}\n" if bits else ""

    def _log(self, d: RepairDecision) -> RepairDecision:
        self.stats.append(d.as_log())
        del self.stats[:-500]
        line = (f"[Voice Agent] 🩹 Repair: {d.kind} ({d.confidence:.2f}, {d.source}, {d.ms:.0f} ms)"
                + (f" -> {d.resolved_request!r}" if d.resolved_request else "") + (f" [{d.note}]" if d.note else ""))
        try:
            print(line, flush=True)
        except UnicodeEncodeError:  # a console that cannot show the marker must not break a turn
            print(line.encode("ascii", "replace").decode("ascii"), flush=True)
        return d

    async def classify(self, text: str, last_request: str = "", last_reply: str = "", last_action: str = "") -> RepairDecision:
        """kind + confidence for a cue turn that code could not settle. Never raises, never takes longer than `timeout_ms`."""
        raw, failed, ms = await self._ask(CLASSIFY_SYSTEM, f"{self._context(last_request, last_reply, last_action)}Sentence: {text}", CLASSIFY_SCHEMA, 24, self.timeout_ms)
        if raw is None:
            return self._log(RepairDecision(source=failed, ms=ms, note=f">{self.timeout_ms:.0f} ms" if failed == "timeout" else "model error"))
        try:
            d = json.loads(raw)
            kind, conf = str(d["kind"]), float(d["confidence"])
            if kind not in KINDS:
                raise ValueError(kind)
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._log(RepairDecision(source="unparsed", ms=ms, note=str(raw)[:60]))
        if kind != "none" and conf < self.min_confidence:
            return self._log(RepairDecision("unclear", "", conf, "model", ms, note=f"was {kind}"))
        return self._log(RepairDecision(kind, "", conf, "model", ms))

    async def rewrite(self, text: str, last_request: str = "", last_reply: str = "", last_action: str = "") -> RepairDecision:
        """The corrected request, for a correction that could not be composed in code. Ignored (kind "none") when it is empty, identical to the
        input, or holds words nobody said."""
        raw, failed, ms = await self._ask(REWRITE_SYSTEM, f"{self._context(last_request, last_reply, last_action)}Sentence: {text}", REWRITE_SCHEMA, 50, self.rewrite_timeout_ms)
        if raw is None:
            return self._log(RepairDecision(source=failed, ms=ms, note=f">{self.rewrite_timeout_ms:.0f} ms" if failed == "timeout" else "model error"))
        try:
            resolved = str(json.loads(raw)["resolved_request"]).strip()
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._log(RepairDecision(source="unparsed", ms=ms, note=str(raw)[:60]))
        if not resolved or _same(resolved, text):
            return self._log(RepairDecision("none", "", 1.0, "rejected", ms, note="rewrite empty or identical to the input"))
        if not honest(resolved, text, last_request):
            return self._log(RepairDecision("none", "", 1.0, "rejected", ms, note=f"{resolved!r} has words that were not said"))
        return self._log(RepairDecision("correction", resolved, 1.0, "rewrite", ms))
