"""Sentences the audio benchmark speaks (Windows SAPI voices), grouped by purpose."""

from __future__ import annotations

import random

from .canon import AC, DOOR, L, VOL, SCREEN, Action, all_lights

# ─── commands spoken after the wake word, with what they must do ──────────
# (spoken text, expected actions, any_of alternatives or None)
COMMANDS: list[tuple[str, list[Action], list[list[Action]] | None]] = [
    ("Hey Travis, turn on the lights.", [], all_lights("on")),
    ("Hey, Travis, turn on the lights.", [], all_lights("on")),
    ("Hey Travis can you set the AC to 24?", [AC("temp", 24)], None),
    ("Hey Travis, set tusker edge to 80 percent.", [L("brightness", "tusker edge", 80)], None),
    ("Hey Travis, lock the door.", [DOOR("lock")], None),
    ("Hey Travis, set the AC to twenty two degrees.", [AC("temp", 22)], None),
    ("Hey Travis, volume up.", [VOL("vol_up")], None),
    ("Hey Travis, turn off tusker L1.", [L("off", "tusker L1")], None),
    ("Hey Travis, make tusker edge blue.", [L("color", "tusker edge", "blue")], None),
    ("Hey Travis, stop tusker 86.", [SCREEN("stop", "tusker 86")], None),
    ("Hey Travis, unlock the door.", [DOOR("unlock")], None),
    ("Hey Travis, turn off the AC.", [AC("off")], None),
    ("Hey Travis, set tusker L3 to fifty percent.", [L("brightness", "tusker L3", 50)], None),
    ("Hey Travis, set the AC to eighteen degrees.", [AC("temp", 18)], None),
    ("Hey Travis, turn on tusker L2.", [L("on", "tusker L2")], None),
    ("Hey Travis, set tusker edge to fifteen percent.", [L("brightness", "tusker edge", 15)], None),
]

# ─── numbers that sound alike, for STT robustness (reference text only) ───
CONFUSABLE = [
    "Hey Travis, set the AC to sixteen degrees.", "Hey Travis, set the AC to sixty degrees.",
    "Hey Travis, set tusker edge to thirteen percent.", "Hey Travis, set tusker edge to thirty percent.",
    "Hey Travis, set tusker edge to fourteen percent.", "Hey Travis, set tusker edge to forty percent.",
    "Hey Travis, set tusker edge to seventeen percent.", "Hey Travis, set tusker edge to seventy percent.",
    "Hey Travis, set tusker edge to eighteen percent.", "Hey Travis, set tusker edge to eighty percent.",
    "Hey Travis, set the AC to twenty four degrees.", "Hey Travis, set the AC to twenty degrees.",
    "Hey Travis, turn on tusker L1.", "Hey Travis, turn on tusker L3.", "Hey Travis, turn off tusker L2.",
    "Hey Travis, lock the door.", "Hey Travis, dim tusker edge to ninety percent.", "Hey Travis, set the AC to nineteen degrees.",
]

# ─── "Travis" said but not to Travis ──────────────────────────────────────
MENTIONS = [
    "Shrutha was talking to Travis yesterday.", "The Travis system is working well.", "I told Travis to wait outside.",
    "We named the project Travis last year.", "Did you ask Travis about the lights?", "Travis was saying we should increase the brightness.",
    "Travis is the name of our voice assistant.", "I was telling a colleague that Travis can control the lights.",
    "Did Travis work well in the demo yesterday?", "Last week Travis turned the lights on by itself.",
    "The vendor asked how Travis handles two people talking.", "Our Travis installation needs a firmware update.",
]

# ─── the name without "hey": not the wake phrase, must not wake ───────────
NO_HEY = [
    "Travis, turn on the lights.", "Travis, lock the door.", "Okay Travis, set the AC to twenty four.",
    "Hi Travis, volume up.", "Travis, turn off tusker edge.", "Travis can you unlock the door?",
]

# ─── meeting talk that never says the wake word ───────────────────────────
MEETING_HANDCRAFTED = [
    "We should increase the brightness for the presentation.", "Can someone turn the AC down?",
    "The lights should probably be around eighty percent.", "Let's switch the display on.",
    "I think the room is a bit warm in here.", "Could we dim the lights a little before the demo?",
    "The AC is set to twenty four right now.", "Please lock the door when you leave.",
    "We need to unlock the door for the delegates.", "Turn off the lights once the video starts.",
    "The company presentation is on slide twelve.", "Let's move to the next slide.",
    "The volume is too low at the back of the room.", "Can you all hear me properly?",
    "Hey, could you open the door for the visitors?", "Someone please mute the call.",
    "Let's go to the next slide and then take questions.", "I will set the temperature to twenty two after lunch.",
    "The screen on the left is showing the flight simulation.", "We can turn the lights off during the video.",
    "Do you want the AC on or off for the workshop?", "Make the text bigger on the slide please.",
    "The brightness is fine, let's keep it at seventy percent.", "Okay everyone, let's start the meeting.",
    "Can you pause the video for a second?", "I'd like to stop sharing my screen now.",
]
_SUBJECTS = ["We", "They", "The client", "Priya", "Rahul", "The visitors", "Our designer", "The manager", "Someone", "I", "The team"]
_DEVICE_TALK = [
    "should increase the brightness for the demo", "could turn the AC down before lunch",
    "want the lights around eighty percent during the talk", "need to lock the door after everyone arrives",
    "asked about the volume on the main screen", "mentioned switching the display on at the start",
    "think the room is too cold today", "will unlock the door for the delegates",
]
_BUSINESS = [
    "reviewed the budget for next quarter", "finished the design for the lobby", "are travelling to Mumbai on Thursday",
    "talked about the new product launch", "want to schedule a follow up call", "shared the report with the whole team",
    "agreed on the timeline for the project", "will send the minutes after the meeting", "are comparing three vendors",
    "need more data before deciding", "liked the first prototype a lot", "plan to hire two engineers this month",
    "worked through the customer feedback", "updated the roadmap for the second half", "discussed the training schedule",
]
# words that sound a little like the wake word
NEAR_MISS = [
    "Davis from accounts joined the call.", "Trevor is travelling to Dubai next week.", "The gravis project is on hold.",
    "Travel plans were discussed at length.", "Tavish will present the next item.", "Doctor Travers sent the notes.",
    "Trivia night is on Friday evening.", "That report was a travesty.", "Tragedy struck the supply chain last year.",
    "The Travis Perkins invoice is overdue.", "Chris and Alice reviewed the plan.", "Avis called about the rental car.",
]


def meeting_sentences(minutes: float, seed: int = 7) -> list[str]:
    """Enough varied meeting talk (no wake word) for roughly `minutes` of speech."""
    rng = random.Random(seed)
    pool = list(MEETING_HANDCRAFTED) + list(NEAR_MISS)
    for s in _SUBJECTS:
        for tail in _DEVICE_TALK:
            pool.append(f"{s} {tail}.")
        for tail in _BUSINESS:
            pool.append(f"{s} {tail}.")
    rng.shuffle(pool)
    need = max(1, int(minutes * 60 / 3.4))  # ~3.4 s per sentence incl. gaps
    return (pool * (need // len(pool) + 1))[:need]
