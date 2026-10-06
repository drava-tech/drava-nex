"""A half-finished brightness request, so the answer to Travis's question finishes it.

"Make it dimmer" has no light and no level. Travis asks for what is missing; the mic
then closes, so the user says "Hey Travis, tusker L3" and later "10 percent". Each
answer fills one slot of the same request instead of starting a new one. Nothing here
guesses: a light is only taken from what was said, a level only from a number that was
said, and "reduce 70%" (a new level, or 70 less?) is asked, never worked out.

Public API:
    Pending                     the request so far (light, level, when it lapses)
    seed(text, ...) -> Pending | None   a brightness request from a first utterance
    fill(pending, text, ...)    take whatever the answer says (light and/or level)
    question(pending, ...)      what to ask next, or None when the request is complete
    is_yes_no(text) -> bool
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field

from nlu.command_matcher import tokenize_numbers

TTL_SEC = 45.0  # long enough to say "Hey Travis" again, short enough to be forgotten

ALL = "lights"  # the name the action guard expands to every light

# A request is about brightness when it has a "change it" word AND a light/brightness word.
_CHANGE = {
    "dim", "dimmer", "dimming", "darker", "brighter", "brighten", "brightness", "reduce", "lower", "decrease",
    "increase", "raise", "less", "more",
}
_LIGHTISH = {"bright", "brighter", "brighten", "brightness", "dim", "dimmer", "dimming", "dark", "darker", "light", "lights", "lamp"}
_REDUCE = {"reduce", "lower", "decrease", "dim", "dimmer", "darker", "increase", "raise", "brighter", "brighten", "less", "more"}
_ALL_WORDS = {"lights", "all", "every", "everything"}
_YES_NO = {"yes", "yeah", "yep", "yup", "correct", "right", "sure", "no", "nope", "nah", "nothing"}
# What Whisper makes of "L3" when the user says it fast: "in 3", "el 3", "elf 3".
_SHORT_NAME = re.compile(r"\b(?:l|el|ll|in|elf|al|all)\s*(\d)\b")


@dataclass
class Pending:
    name: str | None = None  # a light's name as the CMS knows it, or ALL
    level: int | None = None
    ambiguous: int | None = None  # "reduce 70%": said, but not whether it is the new level
    out_of_range: int | None = None
    expires: float = field(default_factory=lambda: time.monotonic() + TTL_SEC)

    @property
    def fresh(self) -> bool:
        return time.monotonic() < self.expires

    @property
    def complete(self) -> bool:
        return self.name is not None and self.level is not None


def _words(text: str) -> list[str]:
    return [t.word for t in tokenize_numbers(text)]


def is_yes_no(text: str) -> bool:
    w = [x for x in _words(text) if x not in {"travis", "hey", "please", "that", "is", "it", "thats"}]
    return bool(w) and len(w) <= 2 and all(x in _YES_NO for x in w)


def is_no(text: str) -> bool:
    return is_yes_no(text) and next(iter(_words(text)), "") in {"no", "nope", "nah", "nothing"}


def _find_light(text: str, names: list[str], aliases: list[tuple[str, str]]) -> tuple[str | None, str]:
    """(light, text with the name taken out). Exact phrases only: a fuzzy match would
    happily turn "L3" into "L1"."""
    norm = f" {' '.join(_words(text))} "
    canon = {" ".join(_words(n)): n for n in names}
    best: tuple[int, str, str] | None = None  # (phrase length, light, phrase)
    phrases = [(k, n) for k, n in canon.items()] + [(a, canon[v]) for a, v in aliases if v in canon]
    for phrase, light in phrases:
        if phrase and f" {phrase} " in norm and (best is None or len(phrase) > best[0]):
            best = (len(phrase), light, phrase)
    if best:
        return best[1], norm.replace(f" {best[2]} ", " ", 1)
    m = _SHORT_NAME.search(norm)
    if m:
        hits = [n for k, n in canon.items() if k.endswith(f"l{m.group(1)}")]
        if len(hits) == 1:
            return hits[0], norm[: m.start()] + " " + norm[m.end():]
    return None, norm


def _find_level(rest: str, direction: bool) -> tuple[int | None, int | None, int | None]:
    """(level, ambiguous, out_of_range) from what is left once the light's name is out."""
    w = rest.split()
    for i, tok in enumerate(w):
        if not tok.isdigit():
            continue
        n = int(tok)
        before = w[i - 1] if i else ""
        explicit_to = before in {"to", "at"} or (i > 1 and w[i - 2] in {"to", "at"} and before in {"about", "around"})
        if direction and not explicit_to:
            return None, n, None  # "reduce 70%", "lower it by 20": a level, or how much to lower?
        if not 0 <= n <= 100:
            return None, None, n
        return n, None, None
    return None, None, None


def fill(p: Pending, text: str, names: list[str], aliases: list[tuple[str, str]]) -> bool:
    """Take a light and/or a level from `text`. True if it said anything useful."""
    light, rest = _find_light(text, names, aliases)
    words = set(rest.split())
    used = False
    if light is not None:
        p.name, used = light, True
    elif p.name is None and words & _ALL_WORDS and "light" not in words:
        p.name, used = ALL, True
    level, ambiguous, out = _find_level(rest, direction=bool(words & _REDUCE))
    if level is not None:
        p.level, p.ambiguous, p.out_of_range, used = level, None, None, True
    elif ambiguous is not None:
        p.ambiguous, p.out_of_range, used = ambiguous, None, True
    elif out is not None:
        p.out_of_range, p.ambiguous, used = out, None, True
    if used:
        p.expires = time.monotonic() + TTL_SEC
    return used


def seed(text: str, names: list[str], aliases: list[tuple[str, str]]) -> Pending | None:
    """A brightness request from a first utterance, or None if it is about something else."""
    words = set(_words(text))
    if not (words & _CHANGE and words & _LIGHTISH):
        return None
    p = Pending()
    fill(p, text, names, aliases)
    p.expires = time.monotonic() + TTL_SEC
    return p


def question(p: Pending, names: list[str]) -> str | None:
    if p.out_of_range is not None:
        return "Brightness goes from 0 to 100 percent. What level would you like?"
    if p.ambiguous is not None:
        return (
            f"Is {p.ambiguous} the new brightness, or how much to lower it? "
            "Tell me the brightness you want, from 0 to 100 percent."
        )
    if p.name is None and p.level is None:
        return "Which light, and what brightness from 0 to 100 percent?"
    if p.name is None:
        listed = ", ".join(names[:-1]) + (f" or {names[-1]}" if len(names) > 1 else "")
        return f"Which light, to {p.level} percent: {listed}?" if names else f"Which light, to {p.level} percent?"
    if p.level is None:
        which = "the lights" if p.name == ALL else p.name
        return f"What brightness for {which}, from 0 to 100 percent?"
    return None
