"""Does the speaker still want what they said? A sentence can take its own request back at
any point and in any words ("turn on the lights, oh no", "set the AC to 22, actually don't",
"lock the door, wait, wait"). Keyword lists never cover every way of changing your mind, so a
short model review reads the whole sentence before anything runs.

Public API:
    IntentCheck(chat, enabled).check(command, history) -> Verdict
    parse_verdict(answer, command) -> Verdict
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_WORD = re.compile(r"[a-z0-9']+")

_SYSTEM = (
    "You read one spoken request to a room-control assistant (lights, AC, door, TV, screens). "
    "It was transcribed from a microphone, so it can hold hesitation or a change of mind. "
    "Decide whether the speaker still wants it done. Answer with exactly one line:\n"
    "GO - they want it carried out. A correction that gives a new version ('no wait, ...', "
    "'I mean ...') is GO, and so is a request that merely starts with 'wait' or 'hold on'.\n"
    "CANCEL - the sentence contains a request AND they take that whole request back, anywhere in the "
    "sentence and in any words. If there is no request in it at all (a question, a remark, chatter, "
    "garbled words), the answer is GO, never CANCEL. Signs of taking it back: "
    "'stop', 'oh no', 'wait', 'hold on', 'never mind', 'forget it', 'not that', 'actually don't', "
    "'on second thought', or any other sign they changed their mind or didn't mean it.\n"
    "KEEP: <text> - they take back only part of it. <text> is the part they still want, "
    "using only their own words.\n"
    "A bare command to stop a screen ('stop the video', 'stop') is GO.\n"
    "Examples:\n"
    "turn on the lights, oh no -> CANCEL\n"
    "set the AC to 22, actually don't -> CANCEL\n"
    "lock the door, wait, wait, wait -> CANCEL\n"
    "turn off the AC, hold on, hold on -> CANCEL\n"
    "turn on the lights, on second thought leave it -> CANCEL\n"
    "switch off the lamp, not that -> CANCEL\n"
    "wait, never mind -> CANCEL\n"
    "hold on a second, turn on the lights -> GO\n"
    "turn on the lights, no wait, turn off the lights -> GO\n"
    "set the AC to 24, no wait, 22 -> GO\n"
    "set the AC to 24, actually make it 22 -> GO\n"
    "switch the lights off, or actually just the lamp -> GO\n"
    "turn on the lights, I mean the AC -> GO\n"
    "stop the video -> GO\n"
    "why is the yeah -> GO\n"
    "what time is it, why so many -> GO\n"
    "make it a bit brighter -> GO\n"
    "turn on the lights and set the AC to 22, actually skip the AC -> KEEP: turn on the lights\n"
    "lock the door and turn off the lights, no not the lights -> KEEP: lock the door"
)


@dataclass
class Verdict:
    kind: str  # "go" | "cancel" | "keep"
    command: str  # what to run: the original, or only the part still wanted


def parse_verdict(answer: str, command: str) -> Verdict:
    """An unreadable answer is GO: the sentence runs as it did before this check existed."""
    lines = (answer or "").strip().splitlines()
    first = lines[0].strip() if lines else ""
    head = first.lower()
    if head.startswith("cancel"):
        return Verdict("cancel", "")
    if head.startswith("keep"):
        kept = first.split(":", 1)[1].strip().strip("\"'") if ":" in first else ""
        if not kept:
            return Verdict("go", command)
        # The kept part must be the speaker's own words: a rewrite that brings in new ones
        # is the model inventing a command, so run what was actually said.
        spoken = set(_WORD.findall(command.lower()))
        kept_words = _WORD.findall(kept.lower())
        if any(w not in spoken for w in kept_words):
            return Verdict("go", command)
        # Keeping everything that was said is not a withdrawal of anything.
        if len(kept_words) >= len(_WORD.findall(command.lower())):
            return Verdict("go", command)
        return Verdict("keep", kept)
    return Verdict("go", command)


class IntentCheck:
    """`chat` is an OllamaChat (anything with `async complete(messages, max_tokens)`)."""

    def __init__(self, chat, enabled: bool = True):
        self._chat = chat
        self.enabled = enabled

    async def check(self, command: str) -> Verdict:
        if not self.enabled or not command.strip():
            return Verdict("go", command)
        messages = [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": f"Request: {command}"},
        ]
        try:
            answer = await self._chat.complete(messages, max_tokens=30)
        except Exception:
            return Verdict("go", command)
        return parse_verdict(answer, command)
