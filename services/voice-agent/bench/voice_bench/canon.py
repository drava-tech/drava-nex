"""Turn recorded CMS calls into canonical actions, and compare them with what
a test expects.

An action is {"dev", "op", "target", "value"}, e.g.
    {"dev": "ac", "op": "temp", "target": None, "value": 24}
    {"dev": "light", "op": "brightness", "target": "tusker edge", "value": 80}
Different API spellings of the same thing compare equal ("tusker ac" == "the
AC"; one all_lights_on == four lights_on). A value of "*" in an expectation
matches anything. Read-only calls (status, inventory) are kept apart from
actuation, and calls are flagged when their values are outside what the
hardware accepts — whether or not the CMS would have rejected them.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from . import names

WILDCARD = "*"
Action = dict[str, Any]


# ─── expectation helpers (used by the case files) ──────────────────────────


def L(op: str, target: str = "all", value: Any = None) -> Action:
    return {"dev": "light", "op": op, "target": target, "value": value}


def AC(op: str, value: Any = None) -> Action:
    return {"dev": "ac", "op": op, "target": None, "value": value}


def VOL(op: str, times: Any = WILDCARD) -> Action:
    return {"dev": "tv_audio", "op": op, "target": None, "value": None if op == "mute" else times}


def TV(op: str) -> Action:
    return {"dev": "tv", "op": op, "target": None, "value": None}


def DOOR(op: str) -> Action:
    return {"dev": "door", "op": op, "target": None, "value": None}


def SCREEN(op: str, screen: str, content: str | None = None) -> Action:
    return {"dev": "screen", "op": op, "target": screen, "value": content}


def SCENE(op: str) -> Action:
    return {"dev": "scene", "op": op, "target": None, "value": None}


def MODE(label: str) -> Action:
    return {"dev": "mode", "op": "set", "target": None, "value": label}


ALL_LIGHTS = ["tusker edge", "tusker L1", "tusker L2"]


def all_lights(op: str) -> list[list[Action]]:
    """Alternatives for 'all the lights on/off': the one API action, or each light."""
    return [[L(op, "all")], [L(op, t) for t in ALL_LIGHTS]]


# ─── canonicalization ──────────────────────────────────────────────────────


def _light_target(spoken: str | None) -> str:
    if not spoken:
        return "all"
    group = names.resolve_device(spoken, group=True)
    if not group:
        return f"unresolved:{spoken}"
    if {d["id"] for d in group} == {"dev-l1", "dev-l2"}:
        return "tusker L3"
    return group[0]["name"] if len(group) == 1 else "+".join(d["name"] for d in group)


def canon_call(call: dict) -> list[Action]:
    """The actions one recorded API call asked for ([] for reads / unreadable)."""
    path, body = call["path"], call.get("body") or {}
    if call["method"] == "GET" or not isinstance(body, dict):
        return []
    out: list[Action] = []
    if path == "/device-command":
        a, target = body.get("action"), body.get("target")
        if a in ("lights_on", "lights_off"):
            out.append(L("on" if a == "lights_on" else "off", _light_target(target)))
        elif a == "lights_set":
            tgt = _light_target(target)
            if body.get("brightness") is not None:
                out.append(L("brightness", tgt, body["brightness"]))
            if body.get("color"):
                out.append(L("color", tgt, _canon_color(body["color"])))
            if body.get("brightness") is None and not body.get("color"):
                out.append(L("on", tgt))
        elif a in ("all_lights_on", "all_lights_off"):
            out.append(L("on" if a == "all_lights_on" else "off", "all"))
        elif a in ("lock", "unlock"):
            out.append(DOOR(a))
        elif a in ("good_morning", "good_night"):
            out.append(SCENE(a))
        elif a == "ambient_mode":
            mode = names.resolve_ambient_mode(target or "")
            out.append(MODE(mode[1] if mode else f"unresolved:{target}"))
        elif a == "ac_command":
            out.extend(_canon_ir(body))
    elif path == "/screen-command":
        a = body.get("action")
        if a == "status":
            return []
        screen = names.resolve_screen(body.get("screen") or "")
        target = screen["label"] if screen else f"unresolved:{body.get('screen')}"
        value = None
        if a in ("assign_experience", "assign_media") and body.get("content"):
            res = (names.resolve_experience if a == "assign_experience" else names.resolve_media)(body["content"])
            value = (res.get("title") or res.get("name")) if res else f"unresolved:{body['content']}"
        out.append(SCREEN(str(a), target, value))
    return out


def _canon_color(c: str) -> str:
    return " ".join(str(c).lower().replace("light", "").split())


def _canon_ir(body: dict) -> list[Action]:
    cmd = str(body.get("command") or "")
    c = "".join(ch for ch in cmd.lower() if ch not in " _-")
    params = body.get("params") or {}
    if c in ("volumeup", "volup", "volumeplus", "volume+"):
        return [VOL("vol_up", params.get("times", 1))]
    if c in ("volumedown", "voldown", "volumeminus", "volume-"):
        return [VOL("vol_down", params.get("times", 1))]
    if c in ("mute", "unmute"):
        return [VOL("mute")]
    devs = names.resolve_device(body.get("target") or "")
    if not devs:
        return [{"dev": "unresolved", "op": cmd, "target": body.get("target"), "value": None}]
    dev = devs[0]
    if dev["ir"] == "ac":
        if cmd == "power_on":
            return [AC("on")]
        if cmd == "power_off":
            return [AC("off")]
        if cmd == "set_temp":
            return [AC("temp", params.get("temp"))]
        if cmd == "set_mode":
            return [AC("mode", params.get("mode"))]
        if cmd == "set_fan":
            return [AC("fan", params.get("fan"))]
        return [{"dev": "ac", "op": f"cmd:{cmd}", "target": None, "value": None}]
    if dev["ir"] == "tv":
        return [TV("power" if cmd.lower() == "power" else f"key:{cmd}")]
    return [{"dev": dev["ir"] or dev["type"], "op": f"cmd:{cmd}", "target": dev["name"], "value": None}]


def is_read(call: dict) -> bool:
    body = call.get("body") or {}
    return call["method"] == "GET" or (isinstance(body, dict) and body.get("action") == "status")


def invalid_reasons(call: dict) -> list[str]:
    """Why a call carries values the hardware/API doesn't accept (empty = fine)."""
    out = list(call.get("flags") or [])
    if not call.get("schema_valid", True):
        out.append("schema_invalid")
    return out


# ─── comparison ────────────────────────────────────────────────────────────


def _key(a: Action) -> tuple:
    return (a["dev"], a["op"], a.get("target"), _norm_value(a.get("value")))


def _norm_value(v: Any) -> Any:
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str):
        return v.strip().lower()
    return v


def _matches(exp: Action, act: Action) -> bool:
    if (exp["dev"], exp["op"]) != (act["dev"], act["op"]):
        return False
    if exp.get("target") != act.get("target"):
        return False
    ev = exp.get("value")
    return ev == WILDCARD or _norm_value(ev) == _norm_value(act.get("value"))


@dataclass
class Match:
    exact: bool = False
    found: int = 0  # expected actions that were produced
    expected: int = 0
    extra: list[Action] = field(default_factory=list)  # produced but not expected
    missing: list[Action] = field(default_factory=list)
    duplicates: list[Action] = field(default_factory=list)  # produced more times than expected
    order_ok: bool = True

    @property
    def partial(self) -> float:
        return 1.0 if self.expected == 0 else self.found / self.expected


def compare(expected: list[Action], actual: list[Action], ordered: bool = False) -> Match:
    remaining = list(actual)
    missing: list[Action] = []
    for exp in expected:
        hit = next((i for i, a in enumerate(remaining) if _matches(exp, a)), None)
        if hit is None:
            missing.append(exp)
        else:
            remaining.pop(hit)
    dupes: list[Action] = []
    counts = Counter(_key(a) for a in actual)
    exp_counts = Counter(_key(e) for e in expected if e.get("value") != WILDCARD)
    for a in actual:
        k = _key(a)
        if counts[k] > max(1, exp_counts.get(k, 1)) and a not in dupes:
            dupes.append(a)
    order_ok = True
    if ordered and not missing:
        idx = [next(i for i, a in enumerate(actual) if _matches(e, a)) for e in expected]
        order_ok = idx == sorted(idx)
    m = Match(
        exact=not missing and not remaining and order_ok,
        found=len(expected) - len(missing),
        expected=len(expected),
        extra=remaining,
        missing=missing,
        duplicates=dupes,
        order_ok=order_ok,
    )
    return m


def best_compare(alternatives: list[list[Action]], actual: list[Action], ordered: bool = False) -> tuple[Match, list[Action]]:
    """The best-fitting expectation among acceptable alternatives."""
    best: tuple[Match, list[Action]] | None = None
    for alt in alternatives:
        m = compare(alt, actual, ordered)
        score = (m.exact, m.partial, -len(m.extra))
        if best is None or score > (best[0].exact, best[0].partial, -len(best[0].extra)):
            best = (m, alt)
    assert best is not None
    return best
