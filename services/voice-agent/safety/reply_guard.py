"""What TRAVIS is allowed to say about an action (local backend).

The rule: it never confirms something it did not do. Two parts.

1. After a tool runs, the confirmation is built from the tool's own result,
   not from the model's wording (`compose`). A result is true by construction:
   "Door unlocked." can only be said if the CMS said so, and a refusal is
   spoken as a refusal. The model is not asked to paraphrase it, which also
   saves a whole extra LLM round (~1 s) per action. Only results that need
   interpretation (knowledge_search) go back to the model.
2. A reply with no tool behind it must not claim an action or a device state
   (`claims_action`): "Turned off 3 lights" or "I'll increase the brightness"
   after zero tool calls is replaced by `unverified_reply`.

Public API:
    ToolResult
    compose(results, wake_hint) -> str | None   spoken text, or None if a model must write it
    claims_action(text) -> bool
    clean_cms_message(text) -> str
    unverified_reply(wake_hint) -> str
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class ToolResult:
    name: str
    args: dict
    ok: bool
    message: str
    extra: dict = field(default_factory=dict)

    @property
    def is_action(self) -> bool:
        """Changes the room (as opposed to reading it)."""
        if self.name in ("device_control", "screen_control"):
            return str(self.args.get("action", "")).lower() != "status"
        return self.name in ("show_visual",)


# Tools whose result is already a sentence to say as it stands.
_SELF_EXPLAINING = {"device_control", "screen_control", "list_inventory", "show_visual"}
_SILENT = {"save_memory"}


def clean_cms_message(text: str) -> str:
    """The CMS's wording minus the instruction aimed at a model ("Only offer these.")."""
    text = re.sub(r"\s*Only offer these\.?", "", text or "").strip()
    if text.rstrip(".").lower() == "invalid request":
        return "I couldn't make sense of that request, so I didn't change anything."
    return text


def _confirmation(r: ToolResult) -> str:
    """A short spoken confirmation for a successful action, from the result."""
    a = r.args or {}
    if r.name == "device_control" and str(a.get("action", "")).lower() == "ac_command":
        cmd = str(a.get("command", "")).lower()
        params = a.get("params") or {}
        if cmd == "power_on":
            return "The AC is on."
        if cmd == "power_off":
            return "The AC is off."
        if cmd == "set_temp" and isinstance(params.get("temp"), (int, float)):
            return f"AC set to {int(params['temp'])} degrees."
        if cmd == "set_mode" and params.get("mode"):
            return f"AC set to {params['mode']} mode."
        if cmd == "set_fan" and params.get("fan"):
            return f"AC fan set to {params['fan']}."
        if cmd == "power" and not params:
            return "Pressed power on the TV."
    return clean_cms_message(r.message)


def compose(results: list[ToolResult], wake_hint: str = "Hey Travis") -> str | None:
    """The spoken reply for this round of tool results, or None when the model has to
    write it (a result like knowledge_search needs interpreting)."""
    if not results:
        return None
    if any(r.name not in _SELF_EXPLAINING and r.name not in _SILENT for r in results):
        return None
    parts: list[str] = []
    for r in results:
        if r.name in _SILENT:
            continue
        text = _confirmation(r) if r.ok else clean_cms_message(r.message)
        if text and text not in parts:
            parts.append(text)
    spoken = " ".join(parts)
    return with_wake_hint(spoken, wake_hint) if spoken else ""


def with_wake_hint(text: str, wake_hint: str = "Hey Travis") -> str:
    """The mic closes after each exchange, so a question must say how to answer it."""
    text = text.strip()
    # "?" anywhere: a question is usually followed by the list of options to pick from.
    if "?" in text and wake_hint.lower() not in text.lower():
        return f"{text} Say {wake_hint}, then your answer."
    return text


# ─── claims about actions / state, for replies with no tool behind them ───

_PERFORMED = re.compile(
    r"\b(done|turned (?:on|off|up|down)|is now|are now|has been|have been|set to|is on|is off|are on|are off|"
    r"unlocked|locked|pushed|all set|switched|sent|stopped|paused|playing|dimmed|brightened|lowered|raised)",
    re.I,
)
_PROMISED = re.compile(
    r"\b(i'?ll|i will|i'?ve|i have|let me|i'?m going to|going to|i'?m)\s+"
    r"(increase|decrease|turn|turning|set|setting|lock|locking|unlock|unlocking|dim|dimming|switch|switching|raise|lower|adjust|adjusting|change|changing|make|making|"
    r"open|opening|close|closing|mute|play|playing|stop|stopping|pause|pausing|brighten|brightening|push|pushing)",
    re.I,
)
_NOT_DONE = re.compile(
    r"(couldn'?t|could not|can'?t|cannot|didn'?t|did not|unable|failed|not (?:able|sure)|don'?t|haven'?t|"
    r"no such|which|what|\?|couldn’t|can’t|didn’t|don’t|haven’t)",
    re.I,
)


def claims_action(text: str) -> bool:
    """True if the text says an action happened or is happening, or states a device
    state as fact — with no admission, question or refusal in it."""
    t = text or ""
    return bool(_PERFORMED.search(t) or _PROMISED.search(t)) and not _NOT_DONE.search(t)


_UNIT_NUMBER = re.compile(r"(\d+(?:\.\d+)?)\s*(?:%|percent|degrees?)", re.I)


def invents_number(text: str, said: set[float]) -> bool:
    """True if the text puts a level or temperature in the user's mouth: "I'll dim it to
    30%" after they said "reduce 70%". A number that wasn't said is never confirmed."""
    return any(float(n) not in said for n in _UNIT_NUMBER.findall(text or ""))


def unverified_reply(wake_hint: str = "Hey Travis") -> str:
    return f"I haven't changed anything yet. What would you like me to do, and on which device? Say {wake_hint}, then your request."
