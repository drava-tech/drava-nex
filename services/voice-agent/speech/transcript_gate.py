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
    strip_wake_word(text, phrase="travis") -> str
    strip_markers(text) -> str

The local pipeline applies the same checks to
Whisper's transcript instead of Gemini's.
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


def _split_phrase(phrase: str) -> tuple[list[str], str]:
    """"hey travis" -> (["hey"], "travis"): the lead words and the name itself."""
    words = phrase.strip().lower().split()
    return (words[:-1], words[-1]) if words else ([], "")


def mentions_wake_word(text: str, phrase: str = "travis") -> bool:
    """Whisper heard the name. Only the last word of a multi-word phrase is
    checked: the wake detector already required "hey" before it, and Whisper
    often writes "Hey, Travis" as "A Travis" or drops the "hey"."""
    _, name = _split_phrase(phrase)
    return any(_is_wake_word(w, name) for w in _wake_candidates(text))


_LEAD = {"hey", "hi", "hello", "ok", "okay", "hay", "ay", "a", "oh", "he"}
# Right after one of these the name only has to be close ("Hey Chavis" scores 0.67): the
# wake detector already heard "hey travis", this check just rules out unrelated speech.
_HEY = {"hey", "hay", "he", "hi"}
_AFTER_HEY_MIN_RATIO = 0.6
_COMMAND_STARTERS = {
    "turn", "switch", "set", "lock", "unlock", "open", "close", "play", "show", "stop",
    "reset", "make", "dim", "put", "start", "good", "can", "could", "please", "volume", "mute",
}


def addressed_to(text: str, phrase: str = "hey travis") -> bool:
    """Whisper heard the name said TO Travis: after "hey" ("Hey, Travis ..."), as a
    vocative at the start ("Travis, ..."), or trailing ("..., hey Travis"). The name inside a
    sentence ("I told Travis to wait", "the Travis system") is a mention, not a call."""
    _, name = _split_phrase(phrase)
    toks = strip_markers(text).split()

    def bare(w: str) -> str:
        return "".join(_LATIN_WORD.findall(w.lower()))

    def is_name(i: int) -> bool:
        return 0 <= i < len(toks) and _is_wake_word(bare(toks[i]), name)

    for i in range(1, min(len(toks), 3)):
        if bare(toks[i - 1]) in _HEY and SequenceMatcher(None, bare(toks[i]), name).ratio() >= _AFTER_HEY_MIN_RATIO:
            return True
    for i in range(min(len(toks), 6)):
        if is_name(i):
            if i > 0 and bare(toks[i - 1]) in _LEAD:
                return True
            if i == 0 and toks[0][-1:] in ",.!?:;":
                return True
            # Whisper often drops the comma ("Travis turn on the lights"): a command
            # word right after a leading name is still a call, not a mention.
            if i == 0 and len(toks) > 1 and bare(toks[1]) in _COMMAND_STARTERS:
                return True
    last = len(toks) - 1
    if last >= 0 and is_name(last):
        if last > 0 and (bare(toks[last - 1]) in _LEAD or toks[last - 1][-1:] in ",;"):
            return True
    # "Tra vis" split in two
    for i in range(min(len(toks), 6) - 1):
        a, b = bare(toks[i]), bare(toks[i + 1])
        if len(a) <= _MAX_FRAGMENT_LEN and len(b) <= _MAX_FRAGMENT_LEN and _is_wake_word(a + b, name):
            if (i > 0 and bare(toks[i - 1]) in _LEAD) or i == 0:
                return True
    return False


def has_speech_beyond_wake_word(text: str, phrase: str = "travis") -> bool:
    """True if the transcript contains any real word other than the wake
    word itself — i.e. the user has started saying something."""
    lead, phrase = _split_phrase(phrase)
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
    ignored = {*lead, "hey"}
    return any(
        len(w) >= 2 and w not in fragments and w not in ignored and not _is_wake_word(w, phrase)
        for w in words
    )


def strip_wake_word(text: str, phrase: str = "travis") -> str:
    """The command without the wake word around it: "Trevis, lights on" ->
    "lights on". Only leading/trailing wake-like words (and "hey"/"ok"
    before them) are removed, so a name in the middle of a sentence stays."""
    _, phrase = _split_phrase(phrase)
    words = strip_markers(text).split()

    def bare(w: str) -> str:
        return "".join(_LATIN_WORD.findall(w.lower()))

    def wake_at(i: int) -> int:
        """How many words starting at i spell the wake word (0 = none)."""
        if i < len(words) and _is_wake_word(bare(words[i]), phrase):
            return 1
        if (
            i + 1 < len(words)
            and len(bare(words[i])) <= _MAX_FRAGMENT_LEN
            and len(bare(words[i + 1])) <= _MAX_FRAGMENT_LEN
            and _is_wake_word(bare(words[i]) + bare(words[i + 1]), phrase)
        ):
            return 2
        return 0

    start = 0
    while start < len(words):
        if bare(words[start]) in ("hey", "ok", "okay", "hi") and wake_at(start + 1):
            start += 1
        n = wake_at(start)
        if not n:
            break
        start += n
    end = len(words)
    while end > start and _is_wake_word(bare(words[end - 1]), phrase):
        end -= 1
        if end > start and bare(words[end - 1]) in ("hey", "ok", "okay"):
            end -= 1  # the "hey" in a trailing "..., hey Travis"
    return " ".join(words[start:end]).strip(" ,.!?;:-")
