"""The structured action plan: what the user MEANT, before anything touches the CMS.

    speech -> STT -> planner (LLM) -> Plan -> target resolution (nlu/resolver.py) -> CMS call

A Plan is the semantic layer on top of the tools this agent already has (device_control,
screen_control): each `op` names one of their actions, and a target is a DESCRIPTION of what is
meant (a category, a scope, maybe a name), never a string to look up in the CMS. "All the lights"
is `type=light, scope=all`; it is not a device called "all the lights".

    {"kind": "actions",
     "actions": [{"op": "light_set",
                  "target": {"type": "light", "scope": "all"},
                  "parameters": {"brightness": 80}}]}

kind: "actions"  carry out `actions` in order
      "clarify"  something needed is missing: speak `question`, change nothing
      "cancel"   the user took the whole request back
      "other"    not a room-control request (a question, chat, company info): the model answers it

Public API:
    PLAN_SCHEMA            JSON schema handed to Ollama so the output is always well-formed
    parse_plan(text) -> Plan | None
    Plan, Action, Target
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

# op -> (tool, fixed args). The tool arguments the resolved target and parameters are added to.
OPS: dict[str, tuple[str, dict]] = {
    "light_on": ("device_control", {"action": "lights_on"}),
    "light_off": ("device_control", {"action": "lights_off"}),
    "light_set": ("device_control", {"action": "lights_set"}),
    "light_status": ("device_control", {"action": "status"}),  # a QUESTION about a light: is it on, how bright
    "light_adjust": ("device_control", {"action": "lights_set"}),  # brighter / dimmer with no level: asks for it
    "ac_on": ("device_control", {"action": "ac_command", "command": "power_on"}),
    "ac_off": ("device_control", {"action": "ac_command", "command": "power_off"}),
    "ac_set_temperature": ("device_control", {"action": "ac_command", "command": "set_temp"}),
    "ac_set_mode": ("device_control", {"action": "ac_command", "command": "set_mode"}),
    "ac_set_fan": ("device_control", {"action": "ac_command", "command": "set_fan"}),
    "ac_adjust": ("device_control", {"action": "ac_command", "command": "set_temp"}),  # warmer / cooler with no number: asks for it
    "volume_up": ("device_control", {"action": "ac_command", "command": "Volume Up"}),
    "volume_down": ("device_control", {"action": "ac_command", "command": "Volume Down"}),
    "mute": ("device_control", {"action": "ac_command", "command": "mute"}),
    "tv_power": ("device_control", {"action": "ac_command", "command": "Power", "target": "tv"}),
    "door_lock": ("device_control", {"action": "lock"}),
    "door_unlock": ("device_control", {"action": "unlock"}),
    "scene_start_day": ("device_control", {"action": "good_morning"}),
    "scene_end_day": ("device_control", {"action": "good_night"}),
    "ambient_mode": ("device_control", {"action": "ambient_mode"}),
    "screen_show": ("screen_control", {"action": "assign_content"}),
    "screen_stop": ("screen_control", {"action": "stop"}),
    "screen_idle": ("screen_control", {"action": "idle"}),
    "screen_play": ("screen_control", {"action": "play"}),
    "screen_pause": ("screen_control", {"action": "pause"}),
    "screen_next": ("screen_control", {"action": "next_item"}),
    "screen_previous": ("screen_control", {"action": "previous_item"}),
    "screen_forward": ("screen_control", {"action": "seek_forward"}),
    "screen_back": ("screen_control", {"action": "seek_back"}),
    "screen_reset_view": ("screen_control", {"action": "reset_view"}),
    "screen_status": ("screen_control", {"action": "status"}),  # a QUESTION about a screen: is it on, what is it showing
}

TARGET_TYPES = ["light", "ac", "screen", "tv", "door", "mode", "room", "none"]
SCOPES = ["all", "specific", "group", "reference", "none"]
# What the model is shown for "none": a word that cannot be read as "no target needed" when the
# request does name a kind of thing ("the lights"); measured +3 of 30 phrasings over "none".
_SCOPE_ENUM = ["all", "specific", "group", "reference", "unspecified"]
KINDS = ["actions", "clarify", "cancel", "question", "suggest", "other"]
# What a "suggest" statement ("it's too cold in here") says the room should be: Travis proposes the change and does it only after a yes (agent/suggest_route.py).
NEEDS = ["warmer", "cooler", "brighter", "dimmer", "louder", "quieter"]
# What a "question" is about: answered from the knowledge base, never from the model's own memory.
TOPICS = ["company", "cms", "travis", "experience_center", "chat"]

_TARGET_COMMON = {
    "type": {"type": "string", "enum": TARGET_TYPES},
}
# Pointing back at something ("them", "it", "the second one") must say WHICH words point back: the schema
# makes the model write them (a request with no pointing words never refers to an earlier thing).
_TARGET_SCHEMA = {
    "anyOf": [
        {
            "type": "object",
            "properties": {**_TARGET_COMMON, "scope": {"type": "string", "enum": ["reference"]}, "words": {"type": "string"}, "index": {"type": "integer"}},
            "required": ["type", "scope", "words"],
        },
        {
            "type": "object",
            "properties": {
                **_TARGET_COMMON,
                "scope": {"type": "string", "enum": [x for x in _SCOPE_ENUM if x != "reference"]},
                "words": {"type": "string"},
                "name": {"type": "string"},
                "location": {"type": "string"},
            },
            "required": ["type", "scope"],
        },
    ]
}

# Ops whose whole meaning is a value: the schema makes the model WRITE it, so it cannot silently leave it out
# (a request with no value, "make it brighter", is the op light_adjust / ac_adjust instead).
_REQUIRED_PARAMETERS: dict[str, dict] = {
    "light_set": {
        "type": "object",
        "properties": {"brightness": {"type": "integer"}, "color": {"type": "string"}},
        "anyOf": [{"required": ["brightness"]}, {"required": ["color"]}],
    },
    "ac_set_temperature": {"type": "object", "properties": {"temperature": {"type": "integer"}}, "required": ["temperature"]},
    "ac_set_mode": {"type": "object", "properties": {"mode": {"type": "string"}}, "required": ["mode"]},
    "ac_set_fan": {"type": "object", "properties": {"fan": {"type": "string"}}, "required": ["fan"]},
    "screen_show": {"type": "object", "properties": {"content": {"type": "string"}}, "required": ["content"]},
    "ambient_mode": {"type": "object", "properties": {"mode": {"type": "string"}}, "required": ["mode"]},
}
_OPTIONAL_PARAMETERS = {"type": "object", "properties": {"times": {"type": "integer"}}}


def _action_schema(ops: list[str], parameters: dict) -> dict:
    return {
        "type": "object",
        "properties": {
            "quote": {"type": "string"},
            "op": {"type": "string", "enum": ops},
            "target": _TARGET_SCHEMA,
            "parameters": parameters,
        },
        "required": ["quote", "op", "target", "parameters"],
    }


PLAN_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": KINDS},
        "actions": {
            "type": "array",
            "items": {
                "anyOf": [
                    *(_action_schema([op], params) for op, params in _REQUIRED_PARAMETERS.items()),
                    _action_schema([op for op in OPS if op not in _REQUIRED_PARAMETERS], _OPTIONAL_PARAMETERS),
                ]
            },
        },
        "question": {"type": "string"},
        "topic": {"type": "string", "enum": TOPICS},
        "need": {"type": "string", "enum": NEEDS},
        "need_quote": {"type": "string"},
        "leftover": {"type": "string"},
    },
    "required": ["kind", "actions"],
}


@dataclass
class Target:
    words: str = ""  # the request's own words about the target ("the lights", "them", "tusker edge"), evidence for the rest
    type: str = "none"
    scope: str = "none"
    name: str = ""  # as the user said it; only for scope=specific
    location: str = ""  # "the meeting room"; only for scope=group
    index: int = 0  # "the second light" = 2, "the last one" = -1; only for scope=reference

    def describe(self) -> str:
        bits = [self.type, self.scope]
        if self.words:
            bits.append(f"words={self.words!r}")
        if self.name:
            bits.append(f"name={self.name!r}")
        if self.location:
            bits.append(f"location={self.location!r}")
        if self.index:
            bits.append(f"index={self.index}")
        return " ".join(bits)


@dataclass
class Action:
    op: str
    target: Target = field(default_factory=Target)
    parameters: dict = field(default_factory=dict)
    quote: str = ""  # the words of the request that ask for this action (checked against what was said)


@dataclass
class Plan:
    kind: str = "other"
    actions: list[Action] = field(default_factory=list)
    question: str = ""
    topic: str = ""  # for kind "question": company | cms | travis | experience_center | chat
    leftover: str = ""  # words of the request that are not about the room and got no action ("tell me a joke")
    need: str = ""  # for kind "suggest": one of NEEDS
    need_quote: str = ""  # the words of the statement that say it (checked against the request)

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "actions": [
                {"quote": a.quote, "op": a.op, "target": a.target.describe(), "parameters": a.parameters}
                for a in self.actions
            ],
            **({"question": self.question} if self.question else {}),
            **({"topic": self.topic} if self.topic else {}),
            **({"leftover": self.leftover} if self.leftover else {}),
            **({"need": self.need, "need_quote": self.need_quote} if self.need else {}),
        }


def quote_supported(quote: str, request: str) -> bool:
    """Were these words really said? Every word of the quote must be in the request, in order (gaps
    allowed: speech is transcribed loosely). An action the model cannot quote was not asked for."""
    said = re.findall(r"[a-z0-9]+", (request or "").lower().replace("%", " percent "))
    wanted = re.findall(r"[a-z0-9]+", (quote or "").lower().replace("%", " percent "))
    if not wanted:
        return False
    it = iter(said)
    return all(w in it for w in wanted)


def _clean(value: Any) -> Any:
    """Empty strings and the literal "null"/"none" the model sometimes writes are 'not given'."""
    if isinstance(value, str) and value.strip().lower() in ("", "null", "none", "n/a", "unknown"):
        return None
    return value


def _target(raw: Any) -> Target:
    raw = raw if isinstance(raw, dict) else {}
    ttype = str(_clean(raw.get("type")) or "none").lower()
    scope = str(_clean(raw.get("scope")) or "none").lower()
    scope = "none" if scope == "unspecified" else scope
    try:
        index = int(raw.get("index") or 0)
    except (TypeError, ValueError):
        index = 0
    return Target(
        words=str(_clean(raw.get("words")) or "").strip(),
        type=ttype if ttype in TARGET_TYPES else "none",
        scope=scope if scope in SCOPES else "none",
        name=str(_clean(raw.get("name")) or "").strip(),
        location=str(_clean(raw.get("location")) or "").strip(),
        index=index,
    )


def parse_plan(text: str) -> Plan | None:
    """The plan in the model's answer, or None if it isn't one (the caller falls back)."""
    if not text:
        return None
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        raw = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(raw, dict):
        return None
    kind = str(raw.get("kind") or "").lower()
    if kind not in KINDS:
        return None
    actions: list[Action] = []
    for a in raw.get("actions") or []:
        if not isinstance(a, dict) or a.get("op") not in OPS:
            continue
        params = a.get("parameters") if isinstance(a.get("parameters"), dict) else {}
        params = {k: v for k, v in params.items() if _clean(v) is not None}
        actions.append(Action(str(a["op"]), _target(a.get("target")), params, str(_clean(a.get("quote")) or "").strip()))
    question = re.sub(r"\s+", " ", str(_clean(raw.get("question")) or "")).strip()
    if kind == "actions" and not actions:
        kind = "clarify" if question else "other"
    leftover = re.sub(r"\s+", " ", str(_clean(raw.get("leftover")) or "")).strip()
    if kind == "actions" and question and not leftover:
        leftover = question  # the model wrote the part it can't do ("what is the capital of France") as a question
    topic = str(raw.get("topic") or "").lower()
    need = str(raw.get("need") or "").lower()
    need_quote = str(_clean(raw.get("need_quote")) or "").strip()
    if kind == "suggest" and (need not in NEEDS or actions):
        kind = "other"  # a suggestion names one need and no action; anything else is not understood well enough to propose a change
    return Plan(kind, actions, question if kind != "actions" else "", leftover=leftover, topic=topic if topic in TOPICS else "",
                need=need if kind == "suggest" else "", need_quote=need_quote if kind == "suggest" else "")
