"""Rule-based fast path for TRAVIS: known commands skip the LLM entirely.

A Python port of services/voice-control's matcher (src/utils/text.ts,
src/commands/registry.ts, matcher.ts, resolve.ts) — same phrase syntax, same
normalization and fuzzy rules — reading config/commands.json. Here a matched
command maps to one of this agent's own tools (device_control,
screen_control, shutdown_travis) instead of a voice-control route.

Phrase syntax: (a|b) = alternatives, [word] = optional, {slot} = parameter
defined under "slots". Entries are tried top to bottom and the first exact
match wins. A near miss is only accepted above min_confidence; anything
unmatched, ambiguous or low-confidence goes to the LLM instead.

Public API:
    load_registry(path) -> Registry
    match_command(text, registry, ...) -> Match | None
    resolve(match, now=None) -> Resolution
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

# Words that join two requests. A device/screen name never contains one, so a
# free-text slot that would swallow one is really two commands.
JOINERS = {"and", "then", "also", "plus"}
# Verbs that start a request. A name slot containing one has swallowed the next command.
COMMAND_VERBS = {
    "turn", "switch", "set", "make", "lock", "unlock", "play", "show", "stop", "pause", "push", "dim",
    "open", "close", "start", "increase", "decrease", "raise", "lower", "mute", "put",
}
# Words where "close" is not close enough: swapping one for another reverses the command
# ("turn it on" must never be heard as "turn it down").
POLAR = {
    "on", "off", "up", "down", "lock", "unlock", "open", "close", "start", "stop", "play", "pause", "next",
    "previous", "last", "back", "forward", "louder", "quieter", "warmer", "cooler", "increase", "decrease",
    "raise", "lower", "in", "out", "mute", "unmute",
}

FILLERS = {
    "travis", "the", "a", "an", "please", "my", "to", "can", "could", "would",
    "you", "will", "kindly", "hey", "okay", "ok", "uh", "um", "try", "just",
    "now", "also", "maybe", "quickly",
    # hesitations and "I want / I'd like ..." lead-ins
    "er", "erm", "ah", "hmm", "well", "so", "like", "basically", "i", "d", "want", "need", "wanna", "gonna",
    # pleasantries
    "thanks", "thank", "alright", "great", "perfect", "nice", "awesome",  # not "cool": that is an AC mode
}

UNITS = {
    "zero": 0, "oh": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
    "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90,
}

# Confidence multiplier when one stray unknown word had to be dropped.
STRAY_WORD_PENALTY = 0.85
# Words around a spoken name that aren't part of it ("tusker edge lights").
NAME_NOISE = {"light", "lights", "screen", "display"}


# ─── Text normalization ────────────────────────────────────────────────────


def basic_normalize(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace, "%" -> "percent"."""
    text = text.lower().replace("%", " percent ")
    text = re.sub(r"°c?", " degrees ", text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


@dataclass(frozen=True)
class Token:
    word: str
    # The spoken (numbers-as-digits) word before any fuzzy correction, so a
    # name slot always carries what was actually said.
    source: str


def compile_rewrites(mapping: dict[str, str]) -> list[tuple[re.Pattern, str]]:
    out = []
    for src, dst in mapping.items():
        words = basic_normalize(src).split(" ")
        out.append((re.compile(r"\b" + r"\s+".join(map(re.escape, words)) + r"\b"), dst))
    return out


def tokenize_numbers(text: str, rewrites=()) -> list[Token]:
    """Tokens with spelled-out numbers (0-100) as digits: "twenty two" -> "22"."""
    normalized = basic_normalize(text)
    for pattern, to in rewrites:
        normalized = pattern.sub(to, normalized)
    words = [w for w in normalized.split(" ") if w]
    out: list[Token] = []
    i = 0
    while i < len(words):
        w = words[i]
        prev = out[-1] if out else None
        if w == "hundred" and prev and prev.word in ("1", "a"):
            out[-1] = Token("100", "100")
        elif w in TENS:
            nxt = words[i + 1] if i + 1 < len(words) else None
            unit = UNITS.get(nxt) if nxt is not None else None
            if unit is not None and 0 < unit < 10:
                n = str(TENS[w] + unit)
                i += 1
            else:
                n = str(TENS[w])
            out.append(Token(n, n))
        elif w in UNITS and w != "oh":
            out.append(Token(str(UNITS[w]), str(UNITS[w])))
        else:
            out.append(Token(w, w))
        i += 1
    return out


def normalize_tokens(text: str, rewrites=()) -> list[Token]:
    """Tokens used for matching: numbers converted, filler words dropped."""
    return [t for t in tokenize_numbers(text, rewrites) if t.word not in FILLERS]


def normalize(text: str, rewrites=()) -> str:
    return " ".join(t.word for t in normalize_tokens(text, rewrites))


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return prev[len(b)]


def similarity(a: str, b: str) -> float:
    """1.0 = identical, 0.0 = nothing in common (normalized edit distance)."""
    longest = max(len(a), len(b))
    return 1.0 if longest == 0 else 1 - levenshtein(a, b) / longest


# ─── Registry ──────────────────────────────────────────────────────────────


@dataclass
class Element:
    kind: str  # "word" | "slot"
    value: str  # the word, or the slot name
    slot: dict | None = None


@dataclass
class Pattern:
    command: dict
    phrase: str
    elements: list[Element]
    slot_count: int


@dataclass
class Registry:
    slots: dict[str, dict]
    commands: list[dict]
    patterns: list[Pattern]
    vocabulary: set[str]
    # slot name -> [(alias tokens, canonical value)], longest alias first.
    enum_aliases: dict[str, list[tuple[list[str], str]]]
    rewrites: list = field(default_factory=list)


def expand_phrase(phrase: str) -> list[list[str]]:
    """Expand "(a|b) c [d|e] {slot}" into every concrete token sequence."""
    # Lowercase words but not {slotNames}, which are case-sensitive keys.
    source = re.sub(
        r"\{\w+\}|[^{}]+",
        lambda m: m.group(0) if m.group(0).startswith("{") else m.group(0).lower(),
        phrase,
    )
    source = re.sub(r"\s+", " ", source).strip()
    pos = 0

    def parse_sequence(stop_chars: str) -> list[list[str]]:
        nonlocal pos
        seqs: list[list[str]] = [[]]
        while pos < len(source) and source[pos] not in stop_chars:
            ch = source[pos]
            if ch == " ":
                pos += 1
                continue
            if ch in "([":
                close = ")" if ch == "(" else "]"
                pos += 1
                options: list[list[str]] = []
                while True:
                    options.extend(parse_sequence("|" + close))
                    if pos < len(source) and source[pos] == "|":
                        pos += 1
                        continue
                    if pos >= len(source) or source[pos] != close:
                        raise ValueError(f'Unclosed "{ch}" in phrase: {phrase}')
                    pos += 1
                    break
                if ch == "[":
                    options.append([])
            else:
                end = pos
                while end < len(source) and source[end] not in " ()[]|":
                    end += 1
                options = [[source[pos:end]]]
                pos = end
            seqs = [s + o for s in seqs for o in options]
        return seqs

    out = parse_sequence("")
    if pos != len(source):
        raise ValueError(f'Unexpected "{source[pos]}" in phrase: {phrase}')
    return out


def _compile_tokens(tokens: list[str], slots: dict, phrase: str) -> list[Element]:
    elements: list[Element] = []
    for tok in tokens:
        m = re.fullmatch(r"\{(\w+)\}", tok)
        if m:
            name = m.group(1)
            if name not in slots:
                raise ValueError(f"Unknown slot {{{name}}} in phrase: {phrase}")
            elements.append(Element("slot", name, slots[name]))
            continue
        # Literal words get the same normalization as spoken text, so fillers
        # vanish and number words become digits on both sides.
        for word in normalize(tok).split(" "):
            if word:
                elements.append(Element("word", word))
    return elements


def build_registry(data: dict) -> Registry:
    slots = data.get("slots", {})
    patterns: list[Pattern] = []
    vocabulary: set[str] = set()
    seen: set[str] = set()
    for command in data.get("commands", []):
        if not command.get("intent") or not command.get("phrases"):
            raise ValueError(f"Command entry needs an intent and phrases: {command}")
        if not (command.get("tool") or command.get("reply")):
            raise ValueError(f'Command {command["intent"]} needs "tool" or "reply".')
        for phrase in command["phrases"]:
            for tokens in expand_phrase(phrase):
                elements = _compile_tokens(tokens, slots, phrase)
                if not elements:
                    continue
                # The same normalized pattern under an earlier entry always
                # wins, so a duplicate is dead — skip it.
                key = " ".join(e.value if e.kind == "word" else "{" + e.value + "}" for e in elements)
                if key in seen:
                    continue
                seen.add(key)
                vocabulary.update(e.value for e in elements if e.kind == "word")
                slot_count = sum(1 for e in elements if e.kind == "slot")
                patterns.append(Pattern(command, phrase, elements, slot_count))

    enum_aliases: dict[str, list[tuple[list[str], str]]] = {}
    for name, slot in slots.items():
        if slot.get("type") != "enum":
            continue
        entries = []
        for value, aliases in slot["values"].items():
            for alias in aliases:
                toks = [t.word for t in tokenize_numbers(alias)]
                vocabulary.update(toks)
                entries.append((toks, value))
        entries.sort(key=lambda e: -len(e[0]))
        enum_aliases[name] = entries

    return Registry(
        slots=slots,
        commands=data.get("commands", []),
        patterns=patterns,
        vocabulary=vocabulary,
        enum_aliases=enum_aliases,
        rewrites=compile_rewrites(data.get("rewrites", {})),
    )


def load_registry(path: str | Path) -> Registry:
    return build_registry(json.loads(Path(path).read_text(encoding="utf-8")))


# ─── Matching ──────────────────────────────────────────────────────────────


@dataclass
class Match:
    intent: str
    command: dict
    params: dict[str, Any]
    confidence: float
    method: str  # "exact" | "fuzzy"
    phrase: str
    normalized: str


def _is_number(word: str) -> bool:
    return word.isdigit()


def _alias_for(span: list[str], source_slot: str | None, registry: Registry) -> str | None:
    """The canonical name when the whole spoken name is an alias from enum `source_slot`."""
    if not source_slot:
        return None
    words = [
        w for i, w in enumerate(span)
        if not (w in NAME_NOISE and (i == 0 or i == len(span) - 1))
    ]
    for alias_tokens, value in registry.enum_aliases.get(source_slot, []):
        if alias_tokens == words:
            return value
    return None


def _match_elements(elements, tokens, registry, ei=0, ti=0, params=None):
    params = params or {}
    if ei == len(elements):
        return params if ti == len(tokens) else None
    el = elements[ei]
    if el.kind == "word":
        if ti < len(tokens) and tokens[ti].word == el.value:
            return _match_elements(elements, tokens, registry, ei + 1, ti + 1, params)
        return None

    slot = el.slot or {}
    if slot.get("type") == "number":
        if ti >= len(tokens) or not _is_number(tokens[ti].word):
            return None
        n = int(tokens[ti].word)
        if n < slot.get("min", 0) or n > slot.get("max", 100):
            return None
        return _match_elements(elements, tokens, registry, ei + 1, ti + 1, {**params, el.value: n})

    if slot.get("type") == "enum":
        for alias_tokens, value in registry.enum_aliases.get(el.value, []):
            end = ti + len(alias_tokens)
            if [t.word for t in tokens[ti:end]] != alias_tokens:
                continue
            r = _match_elements(elements, tokens, registry, ei + 1, end, {**params, el.value: value})
            if r is not None:
                return r
        return None

    # Free text: shortest span first, so the literal words after it anchor where it ends.
    # A device/screen slot (aliasesFrom) takes only a name from the room's alias list: any other
    # wording ("brightness of all") is not a name, and the sentence goes to the planner, which
    # reads its meaning. Content titles (no aliasesFrom) are taken as spoken; the CMS resolves them.
    anchor = slot.get("anchor")
    is_content = el.value == "content"
    for end in range(ti + 1, len(tokens) + 1):
        span = [t.source for t in tokens[ti:end]]
        if any(w in JOINERS for w in span):
            break  # two requests, not one name: longer spans only swallow more
        if not is_content and any(w in COMMAND_VERBS for w in span):
            break
        if anchor and span[0] not in anchor and span[-1] not in anchor:
            continue
        value = _alias_for(span, slot.get("aliasesFrom"), registry)
        if value is None:
            if slot.get("aliasesFrom"):
                continue  # a device/screen slot only takes a name the room knows: anything else isn't this command
            value = " ".join(span)
        r = _match_elements(elements, tokens, registry, ei + 1, end, {**params, el.value: value})
        if r is not None:
            return r
    return None


def _first_exact(patterns, tokens, registry):
    for pattern in patterns:
        params = _match_elements(pattern.elements, tokens, registry)
        if params is not None:
            return pattern, params
    return None


def match_command(
    text: str,
    registry: Registry,
    fuzzy: bool = True,
    fuzzy_threshold: float = 0.82,
    min_confidence: float = 0.75,
) -> Match | None:
    """The command `text` asks for, or None (-> the LLM handles it)."""
    tokens = normalize_tokens(text, registry.rewrites)
    normalized = " ".join(t.word for t in tokens)
    if not tokens:
        return None

    exact = _first_exact(registry.patterns, tokens, registry)
    if exact:
        pattern, params = exact
        return Match(pattern.command["intent"], pattern.command, params, 1.0, "exact", pattern.phrase, normalized)
    if not fuzzy:
        return None

    fuzzy_patterns = [p for p in registry.patterns if p.command.get("fuzzy", True) is not False]
    candidates: list[tuple[Pattern, dict, float]] = []

    # (a) Word-level correction: snap each unknown word to the closest
    # registry word, then require an exact pattern match. A corrected word
    # keeps its spoken source, so a name slot is unaffected.
    corrected = False
    word_conf = 1.0
    corrected_tokens = []
    for t in tokens:
        if t.word in registry.vocabulary or _is_number(t.word):
            corrected_tokens.append(t)
            continue
        best_word, best_score = t.word, 0.0
        for v in registry.vocabulary:
            s = similarity(t.word, v)
            if s > best_score:
                best_word, best_score = v, s
        if best_score < fuzzy_threshold or best_word in POLAR:  # a polarity word is never "corrected" into place
            corrected_tokens.append(t)
            continue
        corrected = True
        word_conf = min(word_conf, best_score)
        corrected_tokens.append(Token(best_word, t.source))
    if corrected:
        hit = _first_exact(fuzzy_patterns, corrected_tokens, registry)
        if hit:
            candidates.append((hit[0], hit[1], word_conf))

    # (b) One stray unknown word at the start or end ("that ac 22 degrees").
    # Only words outside the vocabulary are dropped, never a command word.
    base = corrected_tokens if corrected else tokens
    # Leading word only: dropping a trailing one silently drops a value ("set the AC fan
    # to hurricane" must not become "set the AC fan").
    trims = []
    if len(base) > 1 and base[0].word not in registry.vocabulary and not _is_number(base[0].word):
        trims.append(base[1:])
    for trimmed in trims:
        hit = _first_exact(fuzzy_patterns, trimmed, registry)
        if hit:
            candidates.append((hit[0], hit[1], word_conf * STRAY_WORD_PENALTY))

    # (c) Whole-phrase similarity against slot-free patterns ("lights of" ~
    # "lights off"). A parameter must be heard, never inferred from a near
    # miss, and a spoken number must appear in the phrase as-is.
    spoken_numbers = [t.word for t in tokens if _is_number(t.word)]
    for pattern in fuzzy_patterns:
        if pattern.slot_count:
            continue
        phrase_words = [e.value for e in pattern.elements]
        if any(n not in phrase_words for n in spoken_numbers):
            continue
        if any(t.word in POLAR and t.word not in phrase_words for t in tokens):
            continue  # "turn it on" is not a near miss of "turn it down"
        # Only a mis-HEARD word may differ ("of" for "off"), never a different one: "it" is
        # not a typo of "ac", so "switch it off" can't be heard as "switch ac off".
        spoken_only = [t.word for t in tokens if t.word not in phrase_words]
        phrase_only = [w for w in phrase_words if w not in {t.word for t in tokens}]
        if any(w in POLAR for w in phrase_only):
            continue  # on/off/up/down/lock/unlock must be HEARD: "lights of" is asked about, not guessed
        if any(max((similarity(w, p) for p in phrase_only), default=0.0) < 0.6 for w in spoken_only):
            continue
        if any(max((similarity(p, w) for w in spoken_only), default=0.0) < 0.6 for p in phrase_only):
            continue
        score = similarity(normalized, " ".join(phrase_words))
        if score >= fuzzy_threshold:
            candidates.append((pattern, {}, score))

    if not candidates:
        return None
    candidates.sort(key=lambda c: -c[2])
    best_pattern, best_params, best_conf = candidates[0]
    # A near tie between two different intents is a coin flip — refuse it.
    for pattern, _, conf in candidates[1:]:
        if pattern.command["intent"] != best_pattern.command["intent"]:
            if best_conf - conf < 0.05:
                return None
            break
    if best_conf < min_confidence:
        return None
    return Match(
        best_pattern.command["intent"], best_pattern.command, best_params,
        best_conf, "fuzzy", best_pattern.phrase, normalized,
    )


# ─── Resolution ────────────────────────────────────────────────────────────


@dataclass
class Resolution:
    kind: str  # "tool" | "reply"
    tool: str | None = None
    args: dict = field(default_factory=dict)
    # Spoken instead of the tool's own message when the tool succeeds (for a
    # "tool"), or the whole answer (for a "reply").
    text: str | None = None
    # Further calls of the same command, in order ("also" in commands.json).
    also: list[tuple[str, dict]] = field(default_factory=list)


_SLOT_REF = re.compile(r"^\{(\w+(?:\|\w+)*)\}$")
_TEMPLATE_REF = re.compile(r"\{(\w+)\}")


def time_of_day_greeting(now: datetime) -> str:
    if now.hour < 12:
        return "Good morning"
    if now.hour < 17:
        return "Good afternoon"
    return "Good evening"


def _fill(value: Any, slots: dict) -> Any:
    """Replace "{slot}" / "{a|b}" (first one spoken) with the typed value.
    Missing slots drop the key; an object left empty is dropped too."""
    if isinstance(value, str):
        m = _SLOT_REF.match(value)
        if not m:
            return value
        for name in m.group(1).split("|"):
            if slots.get(name) is not None:
                return slots[name]
        return None
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            filled = _fill(v, slots)
            if filled is not None:
                out[k] = filled
        return out or None
    return value


def _render(template: str, slots: dict, now: datetime) -> str:
    values = {**slots, "timeGreeting": time_of_day_greeting(now)}
    return _TEMPLATE_REF.sub(lambda m: str(values.get(m.group(1), m.group(0))), template)


def resolve(match: Match, now: datetime | None = None) -> Resolution:
    """What a matched command does: call a tool, or just answer."""
    now = now or datetime.now()
    command = match.command
    slots = {**command.get("defaults", {}), **match.params}
    say = command.get("say") or command.get("reply")
    text = _render(say, slots, now) if say else None
    if command.get("tool"):
        args = _fill(command.get("args", {}), slots) or {}
        also = [(c["tool"], _fill(c.get("args", {}), slots) or {}) for c in command.get("also", [])]
        return Resolution("tool", command["tool"], args, text, also)
    return Resolution("reply", text=text)
