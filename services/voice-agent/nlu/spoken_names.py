"""How the room's devices are named out loud.

The CMS and commands.json keep the technical names (tusker edge, tusker L1, tusker L2, tusker L3);
visitors hear and say the room's own names:

    tusker edge  -> cove light
    tusker L3    -> sky light        (L1 and L2 together: the default for "the sky light")
    tusker L1    -> sky light front  (only when asked for explicitly)
    tusker L2    -> sky light back   (only when asked for explicitly)

The front and back sky lights are one thing to a visitor, so questions and the device list name
"sky light", never the two halves. Said aloud on their own (an explicit "sky light front") they keep
their names.

The company is "White Tusker", never "The White Tusker": whatever the model or a knowledge file writes, it is said without "the".

Public API:
    say_names(text) -> text with the technical names replaced by the spoken ones, and "the White Tusker" said as "White Tusker"
    HIDDEN_FROM_LISTS    technical names left out of "which light?" and the device list
"""

from __future__ import annotations

import re

SPOKEN = {
    "tusker edge": "cove light",
    "tusker L1": "sky light front",
    "tusker L2": "sky light back",
    "tusker L3": "sky light",
}
HIDDEN_FROM_LISTS = {"tusker L1", "tusker L2"}

# Longest first, whole words, any case: "tusker l3" and "Tusker L3" both match, "tusker L30" does not.
_PATTERN = re.compile(r"\b(" + "|".join(re.escape(k) for k in sorted(SPOKEN, key=len, reverse=True)) + r")\b(?!\d)", re.I)
_LOOKUP = {k.lower(): v for k, v in SPOKEN.items()}


_COMPANY = re.compile(r"\bthe\s+(white\s+tusker)\b", re.I)


def say_names(text: str) -> str:
    text = _COMPANY.sub(lambda m: "White Tusker", text or "")
    return _PATTERN.sub(lambda m: _LOOKUP[m.group(1).lower()], text)
