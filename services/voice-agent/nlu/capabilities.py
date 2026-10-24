"""What Travis can do by voice, what the CMS can read back, and what it can't: one description for every model that writes words.

The executable actions are the planner's OPS table (nlu/plan.py), grouped here into spoken phrases; a test fails if an op is in no group, so
this list cannot drift from what Travis really runs. What can be READ back is what nlu/room_state.py answers from the CMS device and screen
lists. Anything that is in neither list is not available by voice: Travis says so plainly and never pretends.

`text()` goes into the tool-calling model's system prompt (agent/local.py). `can_read(subject)` is the same fact for code that has to decide
whether to say "I can't check that" (agent/suggest_route.py).
"""

from __future__ import annotations

# (what it is, ops, words that name it). Every key of nlu.plan.OPS must be in exactly one group (tests/test_capabilities.py).
EXECUTABLE: list[tuple[str, tuple[str, ...], tuple[str, ...]]] = [
    ("lights: on, off, brightness, colour", ("light_on", "light_off", "light_set", "light_adjust", "light_status"), ("light", "lights", "lighting", "brightness", "lamp")),
    ("the AC: on, off, temperature, mode, fan", ("ac_on", "ac_off", "ac_set_temperature", "ac_set_mode", "ac_set_fan", "ac_adjust"), ("ac", "aircon", "air", "temperature", "cooling", "fan")),
    ("the TV's power", ("tv_power",), ("tv", "television", "power")),
    ("the sound through the TV's remote: volume up, volume down, mute", ("volume_up", "volume_down", "mute"), ("volume", "sound", "audio", "mute", "speaker", "soundbar")),
    ("the door: lock, unlock", ("door_lock", "door_unlock"), ("door", "lock")),
    ("room scenes and lighting modes (pre-entry, entry, meeting, presentation)", ("scene_start_day", "scene_end_day", "ambient_mode"), ("mode", "modes", "scene", "scenes")),
    ("screens: show a named experience or media item, stop, idle, play, pause, next, previous, skip forward or back, reset view, and say what a screen is showing",
     ("screen_show", "screen_stop", "screen_idle", "screen_play", "screen_pause", "screen_next", "screen_previous", "screen_forward", "screen_back",
      "screen_reset_view", "screen_status"), ("screen", "screens", "content", "display", "video", "playback")),
]

# What the CMS reports back (device and screen state lists). True = a real answer can be read; False = Travis can send the command and nothing else.
READABLE: dict[str, bool] = {"lights": True, "ac": True, "screens": True, "tv_power": True, "door": False, "volume": False, "mute": False}

_READABLE_TEXT = "whether each light is on and its brightness, the AC's power and set temperature (when the CMS has them), the TV's power, what each screen is showing or that it is blank"
_UNREADABLE_TEXT = (
    "whether the door is locked, the volume level, whether the sound is muted, whether anyone can hear anything, the AC's mode and fan, "
    "and anything about the soundbar. The TV remote only SENDS volume up, volume down and mute; nothing comes back"
)
_UNSUPPORTED_TEXT = (
    "opening, drawing on or clearing a whiteboard (the CMS has whiteboards for operators, but there is no voice action for them yet), "
    "and anything else that is not in the CAN DO list"
)


def can_read(subject: str) -> bool:
    """Can the CMS tell us the state of this ("lights", "ac", "volume", "door"...)? Unknown subjects are not readable."""
    return READABLE.get(subject, False)


def about(phrase: str) -> str | None:
    """What Travis can do with the thing a capability question names ("change the volume" -> the sound line), straight from the CAN DO list; None if the
    phrase names nothing in it. This is what Travis CAN do by design: a device that is temporarily offline in the CMS does not change the answer."""
    import re

    words = set(re.findall(r"[a-z]+", (phrase or "").lower()))
    return next((label for label, _, names in EXECUTABLE if words & set(names)), None)


def text() -> str:
    """The block appended to the model's system prompt. Short on purpose: it is read on every request."""
    can_do = "; ".join(label for label, _, _ in EXECUTABLE)
    return (
        "WHAT YOU CAN DO, READ AND NOT DO (the only facts you have about the room's abilities):\n"
        f"- CAN DO by voice: {can_do}.\n"
        f"- CAN READ BACK from the CMS: {_READABLE_TEXT}.\n"
        f"- CANNOT READ BACK: {_UNREADABLE_TEXT}. Never say any of these is on, off, muted, unmuted, locked, connected or at some level. "
        "If asked, say you can't check it, and offer the nearest thing you can do (for example turn the volume up) as a question.\n"
        f"- CANNOT DO by voice: {_UNSUPPORTED_TEXT}. Say so briefly and naturally (\"I can't open a whiteboard by voice yet\"). "
        "Do not call a tool for it, and do not substitute a different action.\n"
        "- Having a device or feature in the CMS does not mean you can control it. Only the CAN DO list is available.\n"
        "- An action happened only if its tool result says so. If a tool failed, timed out or answered unclearly, say that plainly: "
        "never turn it into a success."
    )
