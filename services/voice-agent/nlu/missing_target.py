"""A push with no screen: ask for the whole command again, never for the screen alone.

"Push welcome screen to" has a title and no destination. Asking only "which screen?" splits one
request across two utterances ("Hey Travis, tusker 86"), and the second one has lost the title,
so the model asks for that too (seen in the 2026-10-06 log). Saying the whole command again is
faster and can't lose half of it.

Public API:
    missing_screen(command, screen_phrases) -> bool
    repeat_message(wake_hint) -> str
"""

from __future__ import annotations

from nlu.command_matcher import basic_normalize

_PUSH_VERBS = {"push", "send", "cast"}  # always need a destination
_OTHER_VERBS = {"show", "play", "put", "display", "open", "launch", "bring"}  # only when it trails off
_PREPOSITIONS = {"to", "on", "onto", "in", "at"}
_TRAILING_FILLER = {"the", "screen", "display"}


def repeat_message(wake_hint: str) -> str:
    return f"I didn't catch which screen. Please say {wake_hint} and repeat the whole command, with the screen."


def _names_a_screen(padded: str, screen_phrases: set[str]) -> bool:
    return any(p and f" {p} " in padded for p in screen_phrases)


def missing_screen(command: str, screen_phrases: set[str]) -> bool:
    """True when `command` pushes something somewhere but never says where.

    Fires only on clear cases, so a screen the room doesn't know by name ("push X to facade")
    still goes on to be resolved by the CMS:
      - push/send/cast with no "to/on/in <anything>" at all, or
      - show/play/open/... that stops right after a bare "to/on/in (the screen)".
    """
    # basic_normalize, not normalize(): the matcher's normalize() drops filler words like "to" and "on",
    # which are exactly what tells a trailing-off command from a finished one.
    words = basic_normalize(command).split()
    if len(words) < 2:
        return False
    verb = words[0]
    if verb not in _PUSH_VERBS | _OTHER_VERBS:
        return False
    if _names_a_screen(f" {' '.join(words)} ", {basic_normalize(p) for p in screen_phrases}):
        return False
    tail = list(words)
    while tail and tail[-1] in _TRAILING_FILLER:
        tail.pop()
    trails_off = len(tail) > 1 and tail[-1] in _PREPOSITIONS
    if trails_off:
        return True
    if verb in _PUSH_VERBS:
        # "push welcome screen to tusker 86" names a destination (known or not): leave it alone.
        return not any(w in _PREPOSITIONS for w in words[2:])
    return False
