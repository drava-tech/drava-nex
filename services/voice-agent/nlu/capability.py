"""Questions about what Travis can do are not requests to do it.

"Can the CMS turn on the lights", "does Travis lock the door", "how do I turn on the lights", "what happens if I turn off the lights" ask
about an action; they must never run it (a visitor testing the room would switch the lights off, or unlock the door). Direct polite
requests stay commands: "can you turn on the AC", "could you ...", "would you ...", "will you ...", "please ...", "can I have the lights on".

`classify` only reads the FORM of the sentence (who is asked, which question word); whether the rest names a real action is decided by the
caller (agent/commands.py), which answers with a short reply and an offer, and keeps the exact command for a "yes".
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_FILLER = r"(?:(?:hey|ok|okay|so|um|uh|well|and|travis)\s+)*"
# Who is being asked: the system, never "you" (that is a request) and never "I" ("can I have the lights on").
_SUBJECT = r"(?:the\s+)?(?:cms(?:\s+platform|\s+system)?|control\s+system|system|platform|app|travis|it|this|that)"
_SUBJECT_OR_PERSON = rf"(?:i|we|you|one|{_SUBJECT})"

# Unambiguous questions about ability, even in the "you" form: "are you able to mute the TV", "do you support volume", and "can you control / change / adjust
# the volume" (a general verb with no direction, no value and no on/off: nothing to carry out, so it can only be asking what Travis can do).
_ABILITY_PATTERNS: list[re.Pattern] = [
    re.compile(rf"^{_FILLER}(?:are\s+(?:you|u)\s+(?:able|capable)\s+(?:to|of)|do\s+you\s+(?:support|have|offer))\s+(?P<rest>.+)$"),
    re.compile(rf"^{_FILLER}(?:can|could)\s+(?:you|u)\s+(?P<rest>(?:control|handle|adjust|change|manage|operate|set)\s+(?!.*\b(?:\d+|up|down|on|off|to)\b).+)$"),
]
_GENERIC_VERB = re.compile(r"^(?:control|handle|adjust|change|manage|operate|set)\b")
_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("can", re.compile(rf"^{_FILLER}(?:can|could|does|do)\s+{_SUBJECT}\s+(?P<rest>.+)$")),
    ("can", re.compile(rf"^{_FILLER}is\s+it\s+possible\s+to\s+(?P<rest>.+)$")),
    ("howto", re.compile(rf"^{_FILLER}how\s+(?:do|can|could|should|would|does)\s+{_SUBJECT_OR_PERSON}\s+(?P<rest>.+)$")),
    ("howto", re.compile(rf"^{_FILLER}how\s+to\s+(?P<rest>.+)$")),
    ("happens", re.compile(rf"^{_FILLER}what\s+(?:happens|would\s+happen|will\s+happen)\s+(?:if|when)\s+(?:(?:i|we|you|someone|somebody|anyone)\s+)?(?P<rest>.+)$")),
    ("happens", re.compile(rf"^{_FILLER}what\s+if\s+(?:(?:i|we|you|someone|somebody|anyone)\s+)?(?P<rest>.+)$")),
]
_POLITE_REQUEST = re.compile(r"^(?:hey\s+|travis\s+|ok\s+|okay\s+)*(?:please|(?:can|could|would|will)\s+(?:you|i\s+have|we\s+have|i\s+get|we\s+get))\b")


@dataclass(frozen=True)
class Lead:
    kind: str  # can | howto | happens
    inner: str  # what is asked about, as words: "turn on the lights"
    ability: bool = False  # asked in the "can you / are you able to" form (not "can the CMS", "how do I")

    @property
    def generic(self) -> bool:
        """"change the volume": a general verb, so there is no single command to offer; the answer is what Travis can do with it."""
        return self.ability and bool(_GENERIC_VERB.match(self.inner))


def _clean(text: str) -> str:
    t = (text or "").lower().replace("’", "'")
    t = re.sub(r"[^a-z0-9' ]+", " ", t)
    return " ".join(t.split())


def classify(text: str) -> Lead | None:
    """The question about an action in `text`, or None (a request, a statement, or no such question form)."""
    t = _clean(text)
    if not t:
        return None
    for pattern in _ABILITY_PATTERNS:
        m = pattern.match(t)
        if m:
            inner = re.sub(r"^(?:to|just|actually)\s+", "", m.group("rest").strip())
            return Lead("can", inner, ability=True) if inner else None
    if _POLITE_REQUEST.match(t):
        return None
    for kind, pattern in _PATTERNS:
        m = pattern.match(t)
        if m:
            inner = m.group("rest").strip()
            inner = re.sub(r"^(?:to|just|actually)\s+", "", inner)
            return Lead(kind, inner) if inner else None
    return None


DOOR_ACTIONS = ("lock", "unlock")


def touches_door(calls: list[tuple[str, dict]]) -> bool:
    return any(tool == "device_control" and str(args.get("action", "")).lower() in DOOR_ACTIONS for tool, args in calls)


def _as_offer(inner: str) -> str:
    """The action as a short phrase for "I can ... for you": "turn off the lights" -> "turn them off", "turn on the AC" -> "turn it on"; anything
    else is kept as spoken ("set the AC to 22", "stop tusker 86")."""
    m = re.match(r"^(turn|switch)\s+(on|off)\s+(?:the\s+)?(?P<what>.+)$", inner)
    if not m:
        return inner
    what = m.group("what")
    plural = what.endswith("s") and not what.endswith(("ss", "us")) or what.startswith("all ")
    return f"{m.group(1)} {'them' if plural else 'it'} {m.group(2)}"


def reply_text(lead: Lead, door: bool, followup_hint: str = "") -> str:
    """The spoken answer. A door question gets an answer and no offer, ever: Travis does not offer to lock or unlock it."""
    if door:
        return {"can": "Yes, I can do that.", "howto": "You can just ask me.", "happens": "I can do that if you ask me directly."}[lead.kind]
    if lead.kind == "happens":
        return f"I can {_as_offer(lead.inner)} for you. Would you like me to?{followup_hint}"
    lead_in = {"can": "Yes, I can do that.", "howto": "You can just ask me."}[lead.kind]
    return f"{lead_in} Would you like me to {lead.inner}?{followup_hint}"
