"""Target resolution: from a described target to the things that really exist.

The planner (nlu/planner.py) says WHAT is meant: a category, a scope, perhaps a name as spoken.
This module decides which real devices/screens that is, against the names the CMS and
config/commands.json know. Nothing here parses sentences, and the model never invents a CMS name:
a name it wrote is matched to a real one (alias, then a close spelling with the same digits) or it
is NOT resolved and the user is asked, naming the real choices.

    all lights            -> every light the CMS has
    "cove light"          -> "tusker edge" (an alias in commands.json)
    "them" / "the second" -> what the last answer listed or the last command touched (Focus)
    "the bedroom lights"  -> nothing: no light is known by that location -> asked, never guessed

Public API:
    Resolver(registry, light_names, offered_lights, screen_names).resolve(target, focus) -> Resolved
    Focus.remember(kind, names) / Focus.get(kind)
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field

from nlu.command_matcher import Registry, normalize, similarity
from nlu.plan import Target
from nlu.spoken_names import say_names

ALL = "*"  # Focus value meaning "every light"
# Category nouns, not names: a "name" made only of these means the whole category.
_CATEGORY_WORDS = {"light", "lights", "lighting", "lamp", "lamps"}
_NOISE = {"light", "lights", "screen", "display", "lamp"}
_PLURAL_LIGHTS = {"lights", "lighting", "lamps"}
_FUZZY = 0.82


@dataclass
class Resolved:
    ok: bool = False
    names: list[str] = field(default_factory=list)  # real CMS/config names, in order
    everything: bool = False  # the whole category (every light)
    question: str = ""  # spoken when not ok: what was missing, with the real choices
    why: str = ""  # for the log


class Focus:
    """What "them", "that one", "the second one" refer to: the last things listed or acted on."""

    def __init__(self, ttl: float = 120.0):
        self._ttl = ttl
        self._items: dict[str, tuple[list[str], float]] = {}

    def remember(self, kind: str, names: list[str]) -> None:
        if names:
            self._items[kind] = (list(names), time.monotonic())

    def get(self, kind: str) -> list[str]:
        item = self._items.get(kind)
        if item and time.monotonic() - item[1] <= self._ttl:
            return list(item[0])
        return []

    def clear(self) -> None:
        self._items.clear()

    def age(self, seconds: float) -> None:
        self._items = {k: (v, t - seconds) for k, (v, t) in self._items.items()}


def _digits(text: str) -> list[str]:
    """Every number in the name, also glued to a letter ("l9"): tusker L9 is not tusker L1."""
    return re.findall(r"\d+", text)


def _join(names: list[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + f" or {names[-1]}"


# Words that really point back at something said or used earlier. A reference target must contain one: a plain noun ("light") is not a pointer, and
# the model once wrote "light" as a reference, which silently meant "whichever light was used last".
POINTING_WORDS = frozenset("it its them they those these that this same one ones both first second third fourth fifth last other another previous again".split())


def points_back(words: str) -> bool:
    return bool(POINTING_WORDS & set(re.findall(r"[a-z]+", (words or "").lower())))


class Resolver:
    def __init__(self, registry: Registry, light_names: list[str], offered_lights: list[str], screen_names: list[str]):
        self._registry = registry
        self.light_names = list(light_names)
        self.offered_lights = list(offered_lights)
        self.screen_names = list(screen_names)
        self._light_map = self._alias_map("light", self.light_names)
        self._screen_map = self._alias_map("screenAlias", self.screen_names)

    def _alias_map(self, slot: str, names: list[str]) -> dict[str, str]:
        """normalized spoken form -> real name (aliases from commands.json, plus the names themselves)."""
        out: dict[str, str] = {}
        for tokens, value in self._registry.enum_aliases.get(slot, []):
            out[" ".join(tokens)] = value
        for n in names:
            out.setdefault(normalize(n), n)
        return out

    def refresh(self, light_names: list[str] | None = None, screen_names: list[str] | None = None) -> None:
        """The CMS can gain or lose devices while Travis runs; the room's own aliases stay."""
        if light_names is not None:
            self.light_names = list(dict.fromkeys([*self.light_names, *light_names]))
            self._light_map = self._alias_map("light", self.light_names)
        if screen_names is not None:
            self.screen_names = list(dict.fromkeys([*self.screen_names, *screen_names]))
            self._screen_map = self._alias_map("screenAlias", self.screen_names)

    # ── name matching ────────────────────────────────────────────────────
    @staticmethod
    def _match(said: str, table: dict[str, str]) -> str | None:
        key = normalize(said)
        if not key:
            return None
        if key in table:
            return table[key]
        bare = " ".join(w for w in key.split() if w not in _NOISE)
        for alias, value in table.items():
            if " ".join(w for w in alias.split() if w not in _NOISE) == bare and bare:
                return value
        joined = key.replace(" ", "")
        for alias, value in table.items():
            if alias.replace(" ", "") == joined:  # only the spacing differs ("tusker86", "sky light" / "skylight")
                return value
        # A close spelling is fine ("tusker edge" heard as "tusker age"), a different number is not.
        best, score = None, 0.0
        for alias, value in table.items():
            s = similarity(key, alias)
            if _digits(key) == _digits(alias) and s > score:
                best, score = value, s
        return best if score >= _FUZZY else None

    @staticmethod
    def _names_in(text: str, table: dict[str, str]) -> list[str]:
        """Every known name spoken inside `text`, in the order spoken ("tusker L1 and tusker L2" -> both):
        for when the model wrote several names as one."""
        words = normalize(text).split()
        found: list[tuple[int, str]] = []
        taken: set[int] = set()
        for alias in sorted(table, key=lambda a: -len(a.split())):
            parts = alias.split()
            for i in range(len(words) - len(parts) + 1):
                span = set(range(i, i + len(parts)))
                if words[i : i + len(parts)] == parts and not span & taken:
                    taken |= span
                    found.append((i, table[alias]))
        return list(dict.fromkeys(name for _, name in sorted(found)))

    def says_all_lights(self, text: str) -> bool:
        """The plural category noun with no light's name ("turn the lights off"): every light. A fallback for
        when the model left the scope unset; one light is always named or asked about."""
        words = set(normalize(text).split())
        return bool(words & _PLURAL_LIGHTS) and not self._names_in(text, self._light_map)

    def enum(self, slot: str, said: str) -> str | None:
        """A value of a fixed list in commands.json (AC mode, fan speed, colour, ambient mode) from
        the way it was said ("cooling" -> "cool", "pink" -> "magenta"); None if it isn't one."""
        key = normalize(said)
        for tokens, value in self._registry.enum_aliases.get(slot, []):
            if " ".join(tokens) == key:
                return value
        return None

    def light(self, said: str) -> str | None:
        return self._match(said, self._light_map)

    def screen(self, said: str) -> str | None:
        return self._match(said, self._screen_map)

    # ── questions ────────────────────────────────────────────────────────
    def _light_choices(self) -> str:
        return _join([f"the {say_names(n)}" for n in self.offered_lights])

    def _screen_choices(self) -> str:
        return _join(self.screen_names)

    # ── resolution ───────────────────────────────────────────────────────
    def resolve(self, target: Target, focus: Focus) -> Resolved:
        if target.type == "light":
            return self._lights(target, focus)
        if target.type in ("screen", "tv"):
            return self._screens(target, focus)
        # The AC, the door, the room's modes: there is one of each, nothing to choose between.
        return Resolved(ok=True, why=f"{target.type}: single")

    def _lights(self, t: Target, focus: Focus) -> Resolved:
        said = normalize(t.name or t.words)
        generic = bool(said) and set(said.split()) <= _CATEGORY_WORDS  # "the lights": the kind of thing, not a name
        if t.scope == "all" or (t.scope in ("specific", "none") and (generic or (t.scope == "none" and self.says_all_lights(t.words)))):
            return Resolved(ok=True, everything=True, why="all lights")
        if t.scope == "reference":
            return self._light_reference(t, focus)
        if t.scope in ("group", "specific") and self.light(t.name or t.location) is None:
            several = self._names_in(t.name or t.location or t.words, self._light_map)
            if several:
                return Resolved(ok=True, names=several, why=f"{t.name or t.location!r} -> " + ", ".join(several))
        if t.scope == "group":
            return Resolved(
                question=(
                    f"I couldn't find any lights in the {t.location}." if t.location else "I couldn't tell which lights you mean."
                ) + f" I can control {self._light_choices()}. Which would you like?",
                why=f"no lights known for location {t.location!r}",
            )
        if not said:
            return Resolved(question=f"Which light would you like: {self._light_choices()}?", why="no light named")
        name = t.name or (t.words if t.scope == "specific" else "")  # "words" when the model left the name out
        real = self.light(name) if name else None
        if real is None and not name:
            return Resolved(question=f"Which light would you like: {self._light_choices()}?", why="no light named")
        if real is None:
            return Resolved(
                question=f"I couldn't find a light called {name}. I can control {self._light_choices()}. Which would you like?",
                why=f"light {name!r} unknown",
            )
        return Resolved(ok=True, names=[real], why=f"{t.name!r} -> {real}")

    def _light_reference(self, t: Target, focus: Focus) -> Resolved:
        known = focus.get("light")
        if not known:
            return Resolved(question=f"Which light do you mean: {self._light_choices()}?", why="nothing to refer back to")
        if t.index:
            i = t.index - 1 if t.index > 0 else t.index
            if -len(known) <= i < len(known):
                return Resolved(ok=True, names=[known[i]], why=f"item {t.index} of the last list")
            return Resolved(question=f"I only listed {len(known)}. Which light do you mean: {self._light_choices()}?", why="index out of range")
        if known == [ALL]:
            return Resolved(ok=True, everything=True, why="them = all lights")
        return Resolved(ok=True, names=known, why="them = " + ", ".join(known))

    def _screens(self, t: Target, focus: Focus) -> Resolved:
        if t.scope == "reference" or (not t.name and not t.location and not (t.words and t.scope == "specific") and t.scope in ("none", "specific")):
            known = focus.get("screen")
            if t.index and len(known) > 1:
                i = t.index - 1 if t.index > 0 else t.index
                if -len(known) <= i < len(known):
                    return Resolved(ok=True, names=[known[i]], why="item of the last screen list")
            if known:
                return Resolved(ok=True, names=known[:1] if len(known) == 1 else known, why="that screen = " + ", ".join(known))
            return Resolved(question=f"Which screen: {self._screen_choices()}?" if self.screen_names else "Which screen do you mean?", why="no screen named")
        if t.scope == "all":
            return Resolved(ok=True, names=list(self.screen_names), everything=True, why="all screens")
        said = t.name or t.location or (t.words if t.scope == "specific" else "")  # "the screen on the left" has no name, only a description
        real = self.screen(said)
        if real is None:
            return Resolved(
                question=f"I couldn't tell which screen you mean by {said}. The screens are {self._screen_choices()}. Which one do you mean?",
                why=f"screen {said!r} unknown",
            )
        return Resolved(ok=True, names=[real], why=f"{t.name!r} -> {real}")
