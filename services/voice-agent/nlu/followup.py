"""A bare request for more of what was just said ("tell me more", "what else", "go on").

Such a phrase names no subject, so the planner (which is told to ask about cut-off sentences) can mistake it for a fragment. It is
recognised here, by whole phrase after normalising, and sent to the knowledge path as a "more" request. Anything with another word in
it ("more light", "go on the main screen") is not a match and goes through the normal routes.
"""

from __future__ import annotations

import re

_FILLERS = ("hey travis", "please", "okay", "ok", "yeah", "so", "and", "um", "uh")
_SUBJECT = ("", " about it", " about that", " about them")
PHRASES = frozenset(
    {f"tell me more{s}" for s in _SUBJECT}
    | {f"can you tell me more{s}" for s in _SUBJECT}
    | {f"could you tell me more{s}" for s in _SUBJECT}
    | {"more", "more details", "more detail", "more about that", "more about it", "more about them", "what else", "go on", "continue",
       "anything else", "say more", "tell more", "and"}
)


def normalise(text: str) -> str:
    """Lowercase, punctuation gone, filler words gone (kept when nothing else would be left: a lone "and?")."""
    words = re.sub(r"[^a-z0-9' ]+", " ", (text or "").lower().replace("’", "'")).split()
    joined = " ".join(words)
    stripped = joined
    for f in _FILLERS:
        stripped = re.sub(rf"(?<![a-z0-9']){re.escape(f)}(?![a-z0-9'])", " ", stripped)
    stripped = " ".join(stripped.split())
    return stripped or joined


def is_more_request(text: str) -> bool:
    return normalise(text) in PHRASES
