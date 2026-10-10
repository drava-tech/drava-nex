"""Questions about the room RIGHT NOW ("Is the AC on?", "Which lights are on?", "What is playing on the main screen?"): read from the CMS.

Two parts, kept apart on purpose:

    classify(...)   the local model reads the sentence and says what is being asked (schema below). It never answers and cannot ask for a change:
                    its output is a question about one subject, nothing else.
    answer(...)     plain code builds the reply from the CMS lists (devices, screens). Every fact in it comes from that data, so nothing is made
                    up, and where the CMS has no value the reply says so.

Read-only by construction: this module never calls the CMS at all (agent/room_state.py hands it the lists), and the only CMS calls the route
makes are the two list reads. A sentence with an action word (turn, switch, set, lock, ...) is never taken for a state question.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from nlu.canned import ACTION_WORDS
from nlu.spoken_names import HIDDEN_FROM_LISTS, say_names

SUBJECTS = ["lights", "ac", "tv", "screens", "door", "volume", "none"]
QUESTIONS = ["count", "which_on", "status", "playing", "locked", "level", "list", "none"]
SCHEMA = {
    "type": "object",
    "properties": {
        "asks_state": {"type": "boolean"},
        "subject": {"type": "string", "enum": SUBJECTS},
        "question": {"type": "string", "enum": QUESTIONS},
        "which": {"type": "string"},
    },
    "required": ["asks_state", "subject", "question", "which"],
}
SYSTEM = """You read one message said to a room assistant and decide whether it asks about the CURRENT STATE of the room: what is on or off, how many of something there are, what level or temperature something is at, what is playing on a screen, whether the door is locked.
It is NOT a state question if it asks for something the room cannot report (a slide number, a playback position, a time), if it points at something unnamed ("this", "that", "it") that cannot be told from the sentence, if it asks for anything to change (turn, switch, set, make, play, show, lock, unlock, open, close, raise, lower), or if it asks about the company, the CMS software, Travis or how things work.
Fields: asks_state (true only for a state question); subject: lights, ac, tv (the TV, the display, the main screen as a device), screens (what is showing, the presentation, the content), door, volume, or none; question: count (how many), which_on (which ones are on), status (is it on/off, what is its level or temperature), playing (what is showing), locked (is the door locked), level (volume or brightness level), list (which exist), or none; which: the device or screen exactly as the visitor named it, or "" when none was named.
Examples (placeholders for names):
"how many lights are there" -> {"asks_state":true,"subject":"lights","question":"count","which":""}
"which lights are on" -> {"asks_state":true,"subject":"lights","question":"which_on","which":""}
"is <light A> on" -> {"asks_state":true,"subject":"lights","question":"status","which":"<light A>"}
"is the AC on" -> {"asks_state":true,"subject":"ac","question":"status","which":""}
"what is the AC set to" -> {"asks_state":true,"subject":"ac","question":"status","which":""}
"what is playing on <screen A>" -> {"asks_state":true,"subject":"screens","question":"playing","which":"<screen A>"}
"what presentation is open" -> {"asks_state":true,"subject":"screens","question":"playing","which":""}
"is the door locked" -> {"asks_state":true,"subject":"door","question":"locked","which":""}
"what slide are we on" -> {"asks_state":false,"subject":"none","question":"none","which":""}
"how long is the video" -> {"asks_state":false,"subject":"none","question":"none","which":""}
"which screen is showing this" -> {"asks_state":false,"subject":"none","question":"none","which":""}
"turn the AC on" -> {"asks_state":false,"subject":"none","question":"none","which":""}
"what does the CMS do" -> {"asks_state":false,"subject":"none","question":"none","which":""}
Reply with the JSON only."""


@dataclass
class StateQuestion:
    subject: str
    question: str
    which: str = ""


_STATE_AUX = frozenset({"is", "are", "was", "were", "been", "currently", "its", "it's"})
# the room's settled names for its screens (CLAUDE.md "Room names"): the main screen and main TV are tusker 86, the kiosk is tusker 27
SCREEN_ALIASES = {"main screen": "tusker 86", "main tv": "tusker 86", "main display": "tusker 86", "tv": "tusker 86", "display": "tusker 86",
                  "kiosk": "tusker 27", "kiosk screen": "tusker 27"}


def asks_for_a_change(request: str) -> bool:
    """True if the sentence holds an action word used as a request ("turn the AC on", "please switch it off"). The same word right after
    "is/are" is a state ("what is the AC set to", "what presentation is open") and does not count."""
    words = re.findall(r"[a-z']+", (request or "").lower())
    for i, w in enumerate(words):
        if w in ACTION_WORDS and not (set(words[max(0, i - 3):i]) & _STATE_AUX):
            return True
    return False


# The grammatical form of a state question: it is a QUESTION (wh-word or auxiliary first) or an invitation to report ("tell me which...", "let me know if...",
# "check if..."). An imperative ("Show the whiteboard", "Explain how it works") or a statement ("There's no projector here, can you check") is not one.
# This is the sentence's type, not a topic list: the model is asked only about sentences that have the form of a question about the room.
_ASKING = frozenset("is are was were do does did can could will would which what whats what's how who where when whose any tell let check".split())
_LEAD = frozenset("hey travis please ok okay so and also um uh well now".split())


def could_be_state_question(request: str) -> bool:
    """False when `request` cannot be a question about the room right now, so the (0.6 s) classifier is not asked: it asks for a change (the rule
    `parse` applies afterwards anyway), or it is not shaped like a question. True otherwise: the classifier decides."""
    if asks_for_a_change(request):
        return False
    words = [w for w in re.findall(r"[a-z']+", (request or "").lower()) if w not in _LEAD]
    return bool(words) and words[0] in _ASKING


def parse(raw: str, request: str) -> StateQuestion | None:
    """The classifier's answer as a StateQuestion, or None: not a state question, unreadable, or a sentence that asks for a change."""
    if asks_for_a_change(request):
        return None
    try:
        d = json.loads(raw)
        if d.get("asks_state") is not True:
            return None
        subject, question = d.get("subject"), d.get("question")
        if subject not in SUBJECTS or subject == "none" or question not in QUESTIONS or question == "none":
            return None
        return StateQuestion(subject, question, str(d.get("which") or "").strip())
    except (ValueError, AttributeError, TypeError):
        return None


# ── building the reply from the CMS lists ───────────────────────────────────────────────────────────────────────────────────────────────

def _num_words(n: int) -> str:
    return {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight"}.get(n, str(n))


def _the(names: list[str]) -> str:
    return _join([f"the {n}" for n in names])


def _join(names: list[str]) -> str:
    names = list(names)
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def lights(devices: list[dict]) -> list[dict]:
    """The lights as visitors know them: the cove light, and ONE sky light (its front and back halves together, on if either is)."""
    out: list[dict] = []
    sky = [d for d in devices if d.get("type") == "light" and d.get("name") in HIDDEN_FROM_LISTS]
    for d in devices:
        if d.get("type") != "light" or d.get("name") in HIDDEN_FROM_LISTS:
            continue
        s = d.get("state") or {}
        out.append({"name": say_names(str(d.get("name"))), "on": bool(s.get("on")), "level": s.get("brightness")})
    if sky:
        states = [d.get("state") or {} for d in sky]
        on = any(bool(s.get("on")) for s in states)
        levels = [s.get("brightness") for s in states if s.get("on") and isinstance(s.get("brightness"), (int, float))]
        out.append({"name": "sky light", "on": on, "level": max(levels) if levels else None})
    return out


def _find(which: str, items: list[dict]) -> dict | None:
    w = re.sub(r"[^a-z0-9 ]", "", say_names(which).lower()).replace("the ", "").strip()
    if not w:
        return None
    for it in items:
        n = re.sub(r"[^a-z0-9 ]", "", str(it["name"]).lower())
        if n == w or w in n or n in w:
            return it
    return None


def _level(it: dict) -> str:
    return f" at {int(it['level'])}%" if it.get("on") and isinstance(it.get("level"), (int, float)) else ""


def _main_screen(screens: list[dict]) -> dict | None:
    return next((s for s in screens if str(s.get("screenName", "")).strip().lower() == "tusker 86"), None)


def _showing(s: dict) -> str | None:
    if s.get("blanked"):
        return None
    return s.get("experienceName") or s.get("mediaName") or None


def answer(q: StateQuestion, devices: list[dict], screens: list[dict]) -> str:
    """The spoken reply for `q`, built only from the CMS lists. Never says it will check anything: the answer, or why there is none."""
    if q.subject == "door":
        return "I can't tell whether the door is locked: the CMS has no door status to read. I can lock or unlock it if you ask."
    if q.subject == "volume" or (q.subject == "tv" and q.question == "level"):
        return "I can't read the volume: the TV remote only sends volume up, volume down and mute."

    if q.subject == "lights":
        ls = lights(devices)
        if not ls:
            return "The CMS lists no lights."
        if q.which:
            it = _find(q.which, ls)
            if it is None:
                return f"I don't have a light called {q.which}. The lights are {_the([x['name'] for x in ls])}."
            return f"The {it['name']} is {'on' + _level(it) if it['on'] else 'off'}."
        if q.question == "count":
            return f"There {'is' if len(ls) == 1 else 'are'} {_num_words(len(ls))} light{'s' if len(ls) != 1 else ''}: {_the([x['name'] for x in ls])}."
        if q.question in ("which_on", "status", "list"):
            on = [x for x in ls if x["on"]]
            if not on:
                return "No lights are on."
            if len(on) == len(ls) and len(ls) > 1:
                return f"{_the([x['name'] for x in on]).capitalize()} are on."
            return f"{_the([x['name'] + _level(x) for x in on]).capitalize()} {'is' if len(on) == 1 else 'are'} on. The rest {'is' if len(ls) - len(on) == 1 else 'are'} off."
        return "I can't answer that about the lights."

    if q.subject == "ac":
        ac = next((d for d in devices if (d.get("type") == "ir" and "ac" in str(d.get("name", "")).lower()) or str(d.get("name", "")).lower().endswith(" ac")), None)
        if ac is None:
            return "The CMS lists no air conditioner."
        s = ac.get("state") or {}
        if "power" not in s:
            return "The CMS has no state for the AC. Its remote only sends commands."
        temp = s.get("temp")
        t = f", set to {int(temp)} degrees" if s.get("power") and isinstance(temp, (int, float)) and temp else ""
        return f"The CMS shows the AC {'on' if s.get('power') else 'off'}{t}."

    if q.subject in ("tv", "screens"):
        if q.question == "count" or q.question == "list":
            names = [str(s.get("screenName")) for s in screens]
            if not names:
                return "The CMS lists no screens."
            return f"There {'is' if len(names) == 1 else 'are'} {_num_words(len(names))} screen{'s' if len(names) != 1 else ''}: {_join(names)}."
        if q.which:
            alias = SCREEN_ALIASES.get(re.sub(r"^the ", "", q.which.strip().lower()))
            wanted = alias or say_names(q.which)
            s = next((x for x in screens if re.sub(r"[^a-z0-9]", "", str(x.get("screenName", "")).lower()) == re.sub(r"[^a-z0-9]", "", wanted.lower())
                      or re.sub(r"[^a-z0-9]", "", wanted.lower()) in re.sub(r"[^a-z0-9]", "", str(x.get("screenName", "")).lower())), None)
            if s is None:
                return f"I don't have a screen called {q.which}. The screens are {_join([str(x.get('screenName')) for x in screens])}."
            chosen = [s]
        elif q.subject == "tv":
            m = _main_screen(screens)
            chosen = [m] if m else screens[:1]
        else:
            chosen = screens
        if not chosen:
            return "The CMS lists no screens."
        bits = []
        for s in chosen:
            showing = _showing(s)
            bits.append(f"{s.get('screenName')} is showing {showing}" if showing else f"{s.get('screenName')} is {'blank' if s.get('blanked') else 'showing nothing'}")
        if q.subject == "screens" and not q.which and len(chosen) > 1 and not any(_showing(s) for s in chosen):
            return "Nothing is showing on any screen."
        if q.subject == "screens" and not q.which and len(chosen) > 1:
            bits = [b for b, s in zip(bits, chosen) if _showing(s)] or bits
        text = ". ".join(bits) + "."
        if q.subject == "tv":
            tv = next((d for d in devices if str(d.get("name", "")).strip().lower() == "tv"), None)
            s = (tv or {}).get("state") or {}
            if "power" in s and not s.get("power"):
                text = "The CMS shows the TV off. " + text
        return text

    return "I can't answer that from what the CMS reports."
