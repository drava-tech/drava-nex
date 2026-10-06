"""Room fixtures and the CMS's name-resolution rules, shared by the mock CMS
(which resolves names the way apps/api does) and the judge (which turns a
spoken or model-written name into a canonical device so calls can be compared).

Ported from apps/api/src/services/voice-aliases.ts and voice-actions.ts
(normalize / compact / resolveByName / aliasCandidates). The DEVICES, SCREENS,
EXPERIENCES and MEDIA lists are TEST FIXTURES shaped like the real inventory —
the experience and media titles are invented for the benchmark.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ─── Fixtures ──────────────────────────────────────────────────────────────

LIGHT_COLOR_CHOICES = [
    "warm white", "neutral white", "red", "green", "blue", "cyan", "magenta",
    "yellow", "orange", "purple",
]
LIGHT_COLOR_NAMES = {
    "warmwhite", "neutralwhite", "red", "green", "cyan", "blue", "magenta",
    "white", "yellow", "orange", "purple",
}
AC_MODES = ["cool", "heat", "auto", "fan", "dry"]
AC_FANS = ["auto", "low", "mid", "high"]
AC_MIN_TEMP, AC_MAX_TEMP = 16, 30  # physical range the benchmark treats as valid

AMBIENT_MODES = [  # (key, label)
    ("pre_entry", "Pre-entry"), ("entry", "Entry"), ("meeting", "Meeting"), ("presentation", "Presentation"),
]

EXPERIENCES = [
    {"id": "exp-welcome", "title": "Welcome Experience"},
    {"id": "exp-flight", "title": "Flight Simulation"},
    {"id": "exp-dataart", "title": "Data Art Showcase"},
]
MEDIA = [
    {"id": "media-pres", "name": "Company Presentation", "type": "document"},
    {"id": "media-welcome", "name": "Welcome Video", "type": "video"},
    {"id": "media-demo", "name": "Product Demo Reel", "type": "video"},
]

# id, display name (what the voice API lists), type, ir device
DEVICES = [
    {"id": "dev-edge", "name": "tusker edge", "real": "Strip Light", "type": "light", "ir": None},
    {"id": "dev-l1", "name": "tusker L1", "real": "Stretch Fabric 0", "type": "light", "ir": None},
    {"id": "dev-l2", "name": "tusker L2", "real": "Stretch Fabric 1", "type": "light", "ir": None},
    {"id": "dev-ac", "name": "Experience Center AC", "real": "Experience Center AC", "type": "ir", "ir": "ac"},
    {"id": "dev-tv", "name": "TV", "real": "TV", "type": "ir", "ir": "tv"},
    {"id": "dev-soundbar", "name": "Soundbar", "real": "Soundbar", "type": "ir", "ir": "soundbar"},
]
SCREENS = [
    {"screenId": "main-screen", "real": "tv-86inch", "label": "tusker 86"},
    {"screenId": "kiosk", "real": "kiosk", "label": "tusker 27"},
]

# voice-aliases.ts, compact forms
_DEVICE_ALIASES = [
    {"display": "tusker L1", "spoken": ["tuskerl1"], "real": ["stretchfabric0"]},
    {"display": "tusker L2", "spoken": ["tuskerl2"], "real": ["stretchfabric1"]},
    {"display": "tusker edge", "spoken": ["tuskeredge"], "real": ["striplight"]},
    {"display": None, "spoken": ["ac", "theac", "tuskerac", "airconditioner"], "real": ["experiencecenterac"]},
    {"display": None, "spoken": ["tv", "thetv", "television", "tusker86"], "real": ["tv"]},
    {"display": None, "spoken": ["soundbar", "thesoundbar", "speaker", "thespeaker", "speakers"], "real": ["soundbar"]},
]
_GROUP_ALIASES = [{"display": "tusker L3", "spoken": ["tuskerl3"], "members": ["stretchfabric0", "stretchfabric1"]}]
_SCREEN_ALIASES = [
    {"display": "tusker 86", "spoken": ["tusker86"], "real": ["tv86inch"], "ids": ["main-screen"]},
    {"display": "tusker 27", "spoken": ["tusker27"], "real": ["kiosk"], "ids": ["screen-2", "kiosk"]},
]

# ─── Normalization (voice-actions.ts) ──────────────────────────────────────

_NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
    "seven": "7", "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12",
    "thirteen": "13", "fourteen": "14", "fifteen": "15", "sixteen": "16", "seventeen": "17",
    "eighteen": "18", "nineteen": "19",
}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
_SPELLING = {"centre": "center", "theatre": "theater", "litre": "liter", "metre": "meter"}


def normalize(s: str) -> str:
    words = re.sub(r"([a-z])(\d)", r"\1 \2", re.sub(r"(\d)([a-z])", r"\1 \2", s.strip().lower().replace("-", " "))).split()
    out: list[str] = []
    i = 0
    while i < len(words):
        w = words[i]
        if w in _TENS:
            unit = _NUMBER_WORDS.get(words[i + 1]) if i + 1 < len(words) else None
            if unit and 1 <= int(unit) <= 9:
                out.append(str(_TENS[w] + int(unit)))
                i += 2
                continue
            out.append(str(_TENS[w]))
        else:
            out.append(_SPELLING.get(w) or _NUMBER_WORDS.get(w) or w)
        i += 1
    return " ".join(out)


def compact(s: str) -> str:
    return re.sub(r"[\s_-]+", "", normalize(s))


def _levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cur[j] = prev[j - 1] if a[i - 1] == b[j - 1] else 1 + min(prev[j - 1], prev[j], cur[j - 1])
        prev = cur
    return prev[len(b)]


def _similarity(a: str, b: str) -> float:
    m = max(len(a), len(b))
    return 1.0 if m == 0 else 1 - _levenshtein(a, b) / m


def resolve_by_name(query: str, names: list[str]) -> int | None:
    """Index of the one name `query` means, or None (none or ambiguous) — resolveByName()."""
    q = normalize(query)
    if not q:
        return None
    exact = [i for i, n in enumerate(names) if normalize(n) == q]
    if len(exact) == 1:
        return exact[0]
    partial = [i for i, n in enumerate(names) if q in normalize(n) or normalize(n) in q]
    if len(partial) == 1:
        return partial[0]
    if len(partial) > 1:
        return None
    scored = sorted(
        ((_similarity(q, normalize(n)), i) for i, n in enumerate(names)), reverse=True
    )
    scored = [s for s in scored if s[0] >= 0.55]
    if not scored:
        return None
    if len(scored) == 1:
        return scored[0][1]
    return scored[0][1] if scored[0][0] - scored[1][0] >= 0.1 else None


# ─── Resolution ────────────────────────────────────────────────────────────


def _alias_device_ids(spoken: str) -> list[str]:
    q = compact(spoken)
    for rule in _DEVICE_ALIASES:
        if q in rule["spoken"]:
            return [d["id"] for d in DEVICES if compact(d["real"]) in rule["real"]]
    return []


def resolve_device(spoken: str, group: bool = False) -> list[dict]:
    """Devices a spoken target means ([] = the CMS would answer 'couldn't find exactly one')."""
    by_id = [d for d in DEVICES if d["id"] == spoken]
    if by_id:
        return by_id
    if group:
        q = compact(spoken)
        for g in _GROUP_ALIASES:
            if q in g["spoken"]:
                return [d for d in DEVICES if compact(d["real"]) in g["members"]]
    ids = _alias_device_ids(spoken)
    if ids:
        return [d for d in DEVICES if d["id"] == ids[0]]
    aliased_real = {n for r in _DEVICE_ALIASES if r["display"] for n in r["real"]}
    unaliased = [d for d in DEVICES if compact(d["real"]) not in aliased_real]
    idx = resolve_by_name(spoken, [d["real"] for d in unaliased])
    return [unaliased[idx]] if idx is not None else []


def resolve_screen(spoken: str) -> dict | None:
    for s in SCREENS:
        if s["screenId"] == spoken:
            return s
    q = compact(spoken)
    for rule in _SCREEN_ALIASES:
        if q in rule["spoken"]:
            for s in SCREENS:
                if compact(s["real"]) in rule["real"] or s["screenId"] in rule["ids"]:
                    return s
    aliased_real = {n for r in _SCREEN_ALIASES for n in r["real"]}
    unaliased = [s for s in SCREENS if compact(s["real"]) not in aliased_real]
    idx = resolve_by_name(spoken, [s["real"] for s in unaliased])
    return unaliased[idx] if idx is not None else None


def resolve_experience(spoken: str) -> dict | None:
    idx = resolve_by_name(spoken, [e["title"] for e in EXPERIENCES])
    return EXPERIENCES[idx] if idx is not None else None


def resolve_media(spoken: str) -> dict | None:
    idx = resolve_by_name(spoken, [m["name"] for m in MEDIA])
    return MEDIA[idx] if idx is not None else None


def resolve_ambient_mode(spoken: str) -> tuple[str, str] | None:
    q = re.sub(r"[^a-z0-9]", "", spoken.lower())
    for key, label in AMBIENT_MODES:
        if re.sub(r"[^a-z0-9]", "", key.lower()) == q or re.sub(r"[^a-z0-9]", "", label.lower()) == q:
            return key, label
    return None


def options_hint(names: list[str], noun: str, max_n: int = 8) -> str:
    unique = list(dict.fromkeys(names))
    if not unique:
        return ""
    more = f", and {len(unique) - max_n} more" if len(unique) > max_n else ""
    return f" The {noun} are: {', '.join(unique[:max_n])}{more}. Only offer these."


@dataclass
class Fixtures:
    """Mutable room state the mock CMS starts every case from."""

    devices: dict[str, dict] = field(default_factory=dict)
    screens: dict[str, dict] = field(default_factory=dict)
    door_locked: bool = True
    ambient: str | None = None

    @classmethod
    def fresh(cls) -> "Fixtures":
        f = cls()
        for d in DEVICES:
            if d["type"] == "light":
                f.devices[d["id"]] = {"on": False, "brightness": 100}
            elif d["ir"] == "ac":
                f.devices[d["id"]] = {"power": False, "temp": 24, "mode": "cool", "fan": "auto"}
            else:
                f.devices[d["id"]] = {"power": True}
        for s in SCREENS:
            f.screens[s["screenId"]] = {"experienceName": None, "mediaName": None, "blanked": False}
        return f
