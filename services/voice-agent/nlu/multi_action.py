"""Several actions in one sentence, matched exactly, without the model.

"Set the AC to 24 and turn on tusker edge" is two commands the command list already
knows. Splitting at "and / then / also / commas" and matching each part separately is
exact and takes milliseconds; asking the language model to produce both tool calls took
2-4 s and got them all right only 29% of the time in the benchmark.

All-or-nothing: if ANY part isn't a known command (or is one that shouldn't be chained,
like shutdown), nothing is returned and the whole sentence goes to the model as before.
Nothing here guesses.

A part that is just a name ("...and tusker L2") borrows the leading verb of the part
before it ("turn on"), longest verb phrase first and only on an EXACT match, so "turn off
the AC and all the lights" can't become "turn on all the lights". A pronoun ("make it warm
white") takes the name used in the part before it.

Public API:
    split_clauses(text) -> list[str]
    resolve_multi(text, registry, **match_opts) -> list[Step] | None
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from nlu.command_matcher import COMMAND_VERBS, FILLERS, POLAR, Match, Registry, Resolution, match_command, normalize_tokens, resolve

# "and then" / "and also" before plain "and" so they split once.
_SPLIT = re.compile(r"\s*(?:[,;]|\b(?:and then|and also|after that|and|then|also)\b)\s*", re.I)
_PRONOUN = re.compile(r"\b(it|them)\b", re.I)
MAX_CLAUSES = 6
# Never chained with other commands: too consequential, or not an action.
_NOT_CHAINABLE_TOOLS = {"shutdown_travis"}


@dataclass
class Step:
    clause: str
    match: Match
    resolution: Resolution


_PLEASANTRIES = {"thanks", "thank", "you", "okay", "alright", "great", "sure", "yes", "yeah", "right", "good",
                 "perfect", "nice", "awesome", "hello", "hi", "hey", "travis", "please", "now"}
_UNITS = {"percent", "degrees", "degree", "celsius"}


def _words(clause: str) -> list[str]:
    return [t.word for t in normalize_tokens(clause)]


def split_clauses(text: str) -> list[str]:
    parts = [p.strip(" .?!") for p in _SPLIT.split(text or "")]
    parts = [p for p in parts if p]
    # "Turn the, ..., tusker L1 on": a part that is only a verb is the start of the next one.
    merged: list[str] = []
    carry = ""
    for p in parts:
        words = _words(p)
        if words and all(w in COMMAND_VERBS or w in {"on", "off", "up", "down"} for w in words) and len(words) <= 2 and p is not parts[-1]:
            carry = f"{carry} {p}".strip()
            continue
        merged.append(f"{carry} {p}".strip() if carry else p)
        carry = ""
    if carry:
        merged.append(carry)
    return merged


def is_pleasantry(clause: str) -> bool:
    words = _words(clause)
    return bool(words) and all(w in _PLEASANTRIES for w in words) or not any(w not in FILLERS for w in clause.lower().split())


def is_fragment(clause: str) -> bool:
    """Only a polarity word or a number ("off", "28 degrees"): half of a contradiction or a
    broken-off sentence, nothing to act on. A sentence with one is asked about, never run."""
    words = _words(clause)
    return bool(words) and all(w in POLAR or w.isdigit() or w in _UNITS for w in words)


# "turn on" / "switch off" / "turn up": a verb plus a particle. Anything longer starts to
# be the object ("show the flight ..."), which a later part must not borrow.
_PARTICLES = {"on", "off", "up", "down", "out", "in", "back"}


def _verb_phrases(previous: str) -> list[str]:
    """What a bare name can borrow from the part before it, most specific first."""
    words = previous.split()
    phrases = []
    if len(words) > 2 and words[1].lower() in _PARTICLES:
        phrases.append(" ".join(words[:2]))
    if words:
        phrases.append(words[0])
    return phrases


def _usable(match: Match | None) -> Resolution | None:
    if match is None:
        return None
    res = resolve(match)
    if res.kind != "tool" or res.tool in _NOT_CHAINABLE_TOOLS:
        return None
    return res


def _spoken_name(res: Resolution) -> str | None:
    """The device/screen the previous part acted on, as a name that can be said again."""
    for key in ("target", "screen"):
        value = res.args.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def resolve_multi(text: str, registry: Registry, **match_opts) -> list[Step] | None:
    """Every part is a known command, or None."""
    steps, leftover = resolve_parts(text, registry, **match_opts)
    return steps if steps and not leftover else None


def resolve_parts(text: str, registry: Registry, **match_opts) -> tuple[list[Step], list[str]]:
    """(the parts that are known commands, the parts that are not).

    Known parts are only trusted here when they matched EXACTLY and something else in the
    sentence didn't: a near miss next to an unknown part is too easy to get wrong. The
    unknown parts go to the model on their own, so it never has to redo (or skip) the
    parts the command list already handled."""
    raw = split_clauses(text)
    # A part that is only hesitation ("uh", "um") carries nothing.
    clauses = [c for c in raw if normalize_tokens(c, registry.rewrites) and not is_pleasantry(c)]
    # "Thanks Travis, now turn off tusker edge": one request once the pleasantry is dropped.
    if len(clauses) > MAX_CLAUSES or len(clauses) < (1 if len(raw) > len(clauses) else 2):
        return [], []
    steps: list[Step] = []
    leftover: list[str] = []
    previous: str | None = None  # the full text the previous part was matched as
    previous_res: Resolution | None = None
    for clause in clauses:
        res = match = None
        # (candidate text, must it match exactly?)
        candidates: list[tuple[str, bool]] = [(clause, False)]
        if previous_res is not None and _PRONOUN.search(clause):
            name = _spoken_name(previous_res)
            if name:
                candidates.append((_PRONOUN.sub(name, clause), True))
        if previous:
            for verb in _verb_phrases(previous):
                candidates.append((verb + " " + clause, True))
        winner = clause
        for cand, exact_only in candidates:
            match = match_command(cand, registry, **match_opts)
            if exact_only and (match is None or match.method != "exact"):
                continue
            res = _usable(match)
            if res is not None:
                winner = cand
                break
        if res is None or match is None:
            leftover.append(clause)  # not a known command: the model reads this part
            previous, previous_res = None, None
            continue
        steps.append(Step(clause, match, res))
        previous, previous_res = winner, res
    if leftover and any(st.match.method != "exact" for st in steps):
        return [], []  # a near miss beside an unknown part: let the model read it all
    return steps, leftover
