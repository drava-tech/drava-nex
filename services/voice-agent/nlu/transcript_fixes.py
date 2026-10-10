"""Whisper hears the company name wrong in a few repeatable ways ("What is the whitest cove", "Tell me about white tissue").

Seen in logs/exchanges.jsonl (2026-10-08) and on the user's clips: whitest cove, White Dusk Door, white tissue, white vest, white usker. Also
expected: white tasker, white tusk, white husker. Each is replaced by "White Tusker" only as a WHOLE phrase, and never in a sentence that
holds an action word or one of the room's device names (a device command is left exactly as heard).
"""

from __future__ import annotations

import re

MISHEARINGS = ("whitest cove", "white dusk door", "white tissue", "white vest", "white usker", "white tasker", "white tusk", "white husker")
_PATTERN = re.compile(r"(?<![\w'])(" + "|".join(re.escape(m) for m in sorted(MISHEARINGS, key=len, reverse=True)) + r")(?![\w])", re.I)

ACTION_WORDS = frozenset(
    "turn switch set play open close lock unlock increase decrease mute unmute start stop show push dim brighten raise lower".split()
)


def fix_company_name(text: str, device_names=()) -> str:
    """`text` with a misheard company name written as "White Tusker"; unchanged if it looks like a device command."""
    if not text or not _PATTERN.search(text):
        return text
    low = text.lower()
    words = set(re.findall(r"[a-z']+", low))
    if words & ACTION_WORDS or any(n.lower() in low for n in device_names if n):
        return text
    return _PATTERN.sub("White Tusker", text)
