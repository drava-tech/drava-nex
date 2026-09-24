"""English-only command gate for TRAVIS.

Gemini Live understands and, left to itself, will act on a command spoken
in any language (core/prompt.txt's LANGUAGE section only used to control
what language TRAVIS *replies* in, not whether it acts). This module is a
hard, code-level backstop in front of tool/CMS execution: TRAVIS must not
run a command that wasn't spoken in English, even if the model decides to
call a tool anyway despite the system instruction telling it not to.

Detection is deliberately simple and dependency-free: a script-based check.
Speech-to-text (including Gemini's own) transcribes non-English speech into
that language's own script rather than romanizing it, so a Hindi/Telugu/Urdu
command shows up as Devanagari/Telugu/Arabic-script text (and anything
non-Latin is rejected) — a reliable,
deterministic signal with no ML dependency and no risk of misjudging a
short English command. It will NOT catch non-English speech transcribed in
the Latin alphabet (e.g. romanized "Hinglish"); the system-prompt
instruction (core/prompt.txt) is the primary defense for that case.

Public API:
    is_english(text) -> bool
"""

from __future__ import annotations

# Latin-script letters (English plus accented Latin, e.g. a name like
# "José"). Any other letter — Devanagari, Telugu, Arabic, CJK, Cyrillic... —
# is never English. (Was an explicit list of Indian/Arabic scripts until
# 2026-09-24; widened so every non-Latin language is rejected, not just the
# ones listed.)
_LATIN_RANGES = [
    (0x0041, 0x024F),  # Basic Latin letters, Latin-1, Latin Extended-A/B
    (0x1E00, 0x1EFF),  # Latin Extended Additional
]

# Below this many letters, a script ratio is too noisy to trust (one stray
# character shouldn't reject a short English command like "stop") — so a
# short transcript is only rejected when EVERY letter is non-Latin ("सर").
_MIN_LETTERS = 3
# Above this ratio of non-Latin letters, treat the whole utterance as
# non-English.
_REJECT_RATIO = 0.4


def _is_non_english_script(ch: str) -> bool:
    cp = ord(ch)
    return not any(lo <= cp <= hi for lo, hi in _LATIN_RANGES)


def is_english(text: str) -> bool:
    """Best-effort check that `text` (a transcribed command) is English.

    Fails open (returns True) on empty or ambiguous input — this gate exists
    to block clearly non-English speech, not to second-guess every short or
    garbled English transcript.
    """
    if not text:
        return True
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return True
    non_english = sum(1 for c in letters if _is_non_english_script(c))
    if len(letters) < _MIN_LETTERS:
        return non_english < len(letters)
    return (non_english / len(letters)) <= _REJECT_RATIO
