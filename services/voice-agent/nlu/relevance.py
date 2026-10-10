"""Relevance gate: TRAVIS only helps with the room, its screens and devices,
this space and the company, and itself — not general knowledge, news, maths,
jokes or chit-chat (the Gemini version was a general assistant; this one
isn't).

Applied to commands the fast path (nlu/command_matcher.py) did not match,
before they reach the main model. The gate never lets off-topic text through
to it, because an 8B model told to "politely decline" still answers part of a
mixed request ("turn on the lights and what's the capital of France"):

1. A short request that names something in the room, with no "and"/"then"
   joining several asks, is in scope without asking anything.
2. Anything else is reviewed by a tiny call to the same local model, which
   answers OK (all in scope), NONE (nothing in scope: declined), or
   KEEP: <the in-scope part only>. The main model then sees only that part,
   and the agent adds "I can't help with the rest." The review also sees the
   last exchange, so short follow-ups ("and the other one?") stay in scope.

Public API:
    mentions_domain(text) -> bool
    parse_review(answer, command) -> Review
    RelevanceGate(chat, ...).review(command, history) -> Review
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from nlu.command_matcher import COMMAND_VERBS, FILLERS
from nlu.multi_action import split_clauses

# Words that put a request inside the room/venue domain. Deliberately broad:
# a wrong "yes" only reaches the main model, whose prompt still declines
# off-topic requests; a wrong "no" would refuse a real command.
DOMAIN_WORDS = {
    # devices
    "light", "lights", "lamp", "lighting", "brightness", "dim", "brighten", "colour", "color",
    "ac", "aircon", "temperature", "degrees", "cooling", "heating", "fan",
    "door", "lock", "unlock", "locked",
    "volume", "mute", "unmute", "louder", "quieter", "sound", "soundbar", "speaker", "tv",
    "device", "devices", "remote", "power", "projector",
    # screens and content
    "screen", "screens", "display", "kiosk", "monitor", "slide", "slides", "page", "zoom",
    "video", "videos", "media", "image", "images", "photo", "picture", "playlist",
    "experience", "experiences", "content", "idle", "blank", "pause", "play", "resume",
    "push", "cast", "stop", "reset", "view", "next", "previous", "skip", "rewind",
    "email", "gmail", "delete", "upload",
    # scenes and names
    "mode", "ambient", "scene", "entry", "meeting", "presentation",
    "tusker", "edge", "fabric", "l1", "l2", "l3",
    # the venue itself
    "room", "venue", "space", "center", "centre", "lobby", "company", "office", "studio",
    "visitor", "visitors", "booking",
    # TRAVIS and its tools
    "travis", "cms", "inventory", "memory", "remember", "visual", "shutdown",
}

_WORD = re.compile(r"[a-z0-9]+")

# Device words that say a request is about this room (unlike "play", "stop" or "content",
# which turn up in any sentence).
DEVICE_WORDS = {
    "light", "lights", "lamp", "lighting", "brightness", "ac", "aircon", "temperature", "degrees", "fan", "door",
    "volume", "mute", "louder", "quieter", "tv", "soundbar", "tusker", "edge", "fabric", "l1", "l2", "l3", "kiosk",
    "slide", "slides", "presentation", "screen", "screens", "display", "ambient", "mode",
}
_STARTERS = COMMAND_VERBS | {"dim", "brighten", "change", "adjust", "keep", "get", "kill", "bring", "see", "watch", "launch", "cast", "send"}


def mentions_domain(text: str) -> bool:
    return any(w in DOMAIN_WORDS for w in _WORD.findall((text or "").lower()))


def is_room_command(text: str) -> bool:
    """Starts like an instruction AND names a device: skips the model review. A room word
    alone never does ("which TV should I buy", "is too much screen time bad", "play some
    music" are all about something else)."""
    words = _WORD.findall((text or "").lower())
    if not words:
        return False
    first = next((w for w in words if w not in FILLERS and w not in {"hey", "can", "could", "would", "you", "please"}), "")
    return first in _STARTERS and any(w in DEVICE_WORDS for w in words)


_JOINERS = re.compile(r"\b(and|then|also|plus|but|while|after that)\b|[,;]")

_GATE_SYSTEM = (
    "You are a gatekeeper for TRAVIS, the voice assistant of a company's experience center. "
    "TRAVIS only helps with: controlling the room (lights, AC, door, volume, TV), the screens "
    "and the content on them, the experience center and the company (what it is, hours, "
    "location, visitors, its demos and experiences), and questions about TRAVIS itself or what "
    "it can do. The company is called White Tusker: anything about it is in scope, including "
    "its founders, team, projects, clients, awards, prices and jobs, and its own history, and the CMS platform "
    "it builds and everything it does (screens, experiences, media, products, portfolio, whiteboards, "
    "room modes, users and roles). History is in scope only when it is the history of White Tusker, the company, you (TRAVIS), the CMS or the "
    "platform: the history of lighting design, art or a country is out of scope. Other companies and people are not. Everything else is out of scope: "
    "general knowledge, maths, news, weather, sport, jokes, songs, stories, poems, coding, advice, opinions, chit-chat.\n"
    "Read the user's latest message (a short follow-up to the previous exchange counts as in "
    "scope) and answer with exactly one line:\n"
    "OK - everything asked is in scope\n"
    "NONE - nothing asked is in scope\n"
    "KEEP: <text> - only part is in scope; <text> is just the in-scope part, worded as a command\n"
    "Examples:\n"
    "turn the lights blue -> OK\n"
    "it is too bright in here, bring all the lights down to 30 percent -> OK\n"
    "it's freezing, set the AC to 24 -> OK\n"
    "what time do you open -> OK\n"
    "what is this place -> OK\n"
    "what can you control -> OK\n"
    "who founded White Tusker -> OK\n"
    "who is on the team at the company -> OK\n"
    "what awards has White Tusker won -> OK\n"
    "history of White Tusker -> OK\n"
    "how did your company start -> OK\n"
    "tell me about the history of lighting design -> NONE\n"
    "does the CMS support whiteboards -> OK\n"
    "does it support whiteboards -> OK\n"
    "what are experiences in the CMS -> OK\n"
    "who is the CEO of Google -> NONE\n"
    "who is Elon Musk -> NONE\n"
    "what's the capital of France -> NONE\n"
    "tell me a joke about the lights -> NONE\n"
    "what's the weather in the lobby -> NONE\n"
    "write me a poem -> NONE\n"
    "unlock the door and tell me a joke -> KEEP: unlock the door\n"
    "turn on tusker L1 and what's two plus two -> KEEP: turn on tusker L1\n"
    "who won the match yesterday and set the AC to 22 -> KEEP: set the AC to 22\n"
    "turn off the lights and tell me about the company -> OK\n"
    "show the demo on tusker 86 then lock the door -> OK\n"
    "lock the door, sing me a song and set the AC to 22 -> KEEP: lock the door and set the AC to 22\n"
    "KEEP must contain every in-scope part, in the user's own words.\n"
    "(previous: assistant said the edge light is on) and the other one -> OK\n"
    "(previous: assistant said the edge light is on) yes please -> OK\n"
    "(previous: assistant said the edge light is on) tell me a joke -> NONE"
)

# The previous exchange is sent as context, trimmed — it only has to settle
# whether a short reply is a follow-up.
_CONTEXT_CHARS = 160


@dataclass
class Review:
    allowed: bool  # False = decline the whole request
    command: str  # what to run: the original, or only its in-scope part
    dropped: bool = False  # part of the request was out of scope


def parse_review(answer: str, command: str) -> Review:
    """An unreadable answer fails open (the original command goes through):
    a refused real command is the worse error."""
    lines = (answer or "").strip().splitlines()
    first = lines[0].strip() if lines else ""
    head = first.lower()
    if head.startswith("none"):
        return Review(False, "", True)
    if head.startswith("keep"):
        kept = first.split(":", 1)[1].strip().strip("\"'") if ":" in first else ""
        if not kept:
            return Review(False, "", True)  # nothing usable left to run
        # The kept part must be the user's own words. A rewrite that brings in
        # new ones ("and the other one" -> "turn on the other edge light") is
        # the model inventing a command, so run what was actually said.
        spoken = set(_WORD.findall(command.lower()))
        invented = [w for w in _WORD.findall(kept.lower()) if w not in spoken]
        if len(invented) > 1:
            return Review(True, command)
        # "Close and lock the door" -> "lock the door" dropped a filler, not an off-topic
        # part: only a whole clause of real content that is missing from KEEP counts.
        clauses = split_clauses(command)
        if len(clauses) < 2:
            return Review(True, command)
        kept_words = set(_WORD.findall(kept.lower()))
        for clause in clauses:
            words = [w for w in _WORD.findall(clause.lower()) if w not in FILLERS]
            if len(words) >= 2 and sum(w in kept_words for w in words) / len(words) < 0.5:
                return Review(True, kept, True)
        return Review(True, command)
    return Review(True, command)


def gate_messages(command: str, history: list[dict]) -> list[dict]:
    context = ""
    last = [m for m in history if m.get("role") in ("user", "assistant")][-2:]
    if last:
        lines = "\n".join(f'{m["role"]}: {str(m.get("content", ""))[:_CONTEXT_CHARS]}' for m in last)
        context = f"Previous exchange:\n{lines}\n\n"
    return [
        {"role": "system", "content": _GATE_SYSTEM},
        {"role": "user", "content": f"{context}Latest message: {command}"},
    ]


# "History" is in scope only as the history of the company, the CMS or Travis. Checked in code too, before the room-command shortcut, because
# a room word in the sentence ("lighting") would otherwise wave "the history of lighting design" through.
_HISTORY = re.compile(r"\bhistory\b", re.I)
_OURS = re.compile(r"\b(white\s+tusker|tusker|company|you|your|cms|platform|travis|studio)\b", re.I)
_PRONOUN = re.compile(r"\b(it|its|their|they|them)\b", re.I)


def history_out_of_scope(command: str, history: list[dict] | None = None) -> bool:
    """True for a question about a history that is not ours: it names no White Tusker / company / CMS / Travis word, and a bare "its history" does
    not follow something said about one of them."""
    if not _HISTORY.search(command or "") or _OURS.search(command):
        return False
    if _PRONOUN.search(command):
        last = " ".join(str(m.get("content", "")) for m in (history or [])[-2:])
        if _OURS.search(last):
            return False
    return True


class RelevanceGate:
    """`chat` is an OllamaChat (anything with `async complete(messages, max_tokens)`)."""

    def __init__(self, chat, enabled: bool = True):
        self._chat = chat
        self.enabled = enabled

    async def review(self, command: str, history: list[dict] | None = None, corrected: bool = False) -> Review:
        """corrected: the sentence contains a self-correction, so its earlier part is
        superseded, not off topic. It is judged as a whole and never trimmed."""
        if self.enabled and history_out_of_scope(command, history):
            return Review(False, "", True)
        if not self.enabled or (is_room_command(command) and (corrected or not _JOINERS.search(command.lower()))):
            return Review(True, command)
        answer = await self._chat.complete(gate_messages(command, history or []), max_tokens=40)
        review = parse_review(answer, command)
        if corrected and review.allowed:
            return Review(True, command)
        return review
