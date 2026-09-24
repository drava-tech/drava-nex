"""Checks on Gemini's transcript of what the user said, used to decide
whether TRAVIS may answer or act on a turn at all (2026-09-24).

Vosk's wake-word grammar only knows "travis" + "[unk]", so anything that
sounds vaguely like it can fire a wake. Gemini's own transcript of the same
audio (the pre-roll that contained the wake word is streamed to it) is a
second, independent opinion: if it has real words but nothing close to
"travis", the wake was false. Gemini also emits non-speech markers such as
"<noise>" for sounds it can't transcribe — never a command.

All checks fail open on an empty transcript (Gemini's transcription can lag
or skip a lone short word); they only block on positive evidence.

Public API:
    is_noise(text) -> bool
    mentions_wake_word(text, phrase="travis") -> bool
    has_speech_beyond_wake_word(text, phrase="travis") -> bool
    strip_markers(text) -> str
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

# "<noise>", "<unk>", etc. — Gemini's markers for audio it couldn't transcribe.
_MARKER = re.compile(r"<[^<>]*>")
_LATIN_WORD = re.compile(r"[a-z]+")
_ANY_WORD = re.compile(r"[^\W\d_]+")  # letters in any script

# How close a transcribed word must be to the wake phrase. Covers Gemini's
# observed spellings ("Ravis", "Tra vis", "Travis's") and accents ("Trawis",
# "Davis") without matching everyday words ("travel" scores 0.67).
_WAKE_MIN_RATIO = 0.7
# "Tra vis" is re-joined before matching, but only short fragments —
# joining arbitrary neighbours ("travel is") would invent false matches.
_MAX_FRAGMENT_LEN = 4


def strip_markers(text: str) -> str:
    return _MARKER.sub(" ", text or "")


def is_noise(text: str) -> bool:
    """True if the transcript has markers/punctuation but no actual words
    (e.g. "<noise>"). An empty transcript is not noise — it's unknown."""
    if not text or not text.strip():
        return False
    return not _ANY_WORD.search(strip_markers(text))


def _wake_candidates(text: str) -> list[str]:
    words = _LATIN_WORD.findall(strip_markers(text).lower())
    joined = [
        a + b
        for a, b in zip(words, words[1:])
        if len(a) <= _MAX_FRAGMENT_LEN and len(b) <= _MAX_FRAGMENT_LEN
    ]
    return words + joined


def _is_wake_word(word: str, phrase: str) -> bool:
    return SequenceMatcher(None, word, phrase).ratio() >= _WAKE_MIN_RATIO


def mentions_wake_word(text: str, phrase: str = "travis") -> bool:
    phrase = phrase.strip().lower()
    return any(_is_wake_word(w, phrase) for w in _wake_candidates(text))


def has_speech_beyond_wake_word(text: str, phrase: str = "travis") -> bool:
    """True if the transcript contains any real word other than the wake
    word itself — i.e. the user has started saying something."""
    phrase = phrase.strip().lower()
    words = _ANY_WORD.findall(strip_markers(text).lower())
    fragments = {
        a
        for a, b in zip(words, words[1:])
        if _is_wake_word(a + b, phrase)
    } | {
        b
        for a, b in zip(words, words[1:])
        if _is_wake_word(a + b, phrase)
    }
    return any(
        len(w) >= 2 and w not in fragments and not _is_wake_word(w, phrase)
        for w in words
    )
