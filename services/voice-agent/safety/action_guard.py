"""Never guess: every action must be backed by what the user said.

The local model is good at understanding messy speech and bad at restraint: given
"make the room a bit brighter" it sends brightness 60 to a device called "the room";
given "set temperature to banana" it sets the AC to 22. This module sits between the
model (or the command list) and the CMS and turns every guess into a question:

  * a device/screen/content name must have been SAID (or be an alias of something said,
    or be the thing just used when the user says "it/them"),
  * a number (brightness, temperature) must have been said, and be in range,
  * a scene action ("everything off", lock, unlock...) needs its cue words,
  * placeholders ("it", "the room", "that") are never sent to the CMS as names.

A request that fails any check isn't sent. `prepare()` returns a `question` instead,
which is spoken as it is; for model-made calls the same text is fed back so it can retry
once with what the user really said. A plural target ("the lights") is expanded here:
"turn off the lights" becomes all_lights_off, "the lights to 70%" becomes one call per light.

Public API:
    ActionGuard(registry, ttl).prepare(name, args, utterance, light_names, strict) -> Prepared
    ActionGuard.remember(name, args, ok)       what "it/them" can refer to next
    ActionGuard.context_line() -> str          for the model: "Last used: ..."
    ActionGuard.reset()
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from nlu.command_matcher import Registry, normalize, similarity

AC_MIN_TEMP, AC_MAX_TEMP = 16, 30
AC_MODES = ["cool", "heat", "auto", "fan", "dry"]
AC_FANS = ["auto", "low", "mid", "high"]
MAX_VOLUME_STEPS = 10

PRONOUNS = {"it", "that", "this", "them", "those", "these", "one"}
# Names that mean "no particular device": never sent to the CMS.
PLACEHOLDERS = {"it", "that", "this", "them", "those", "these", "room", "here", "there", "something", "everything",
                "one", "device", "thing", "stuff", "all", "other", "other one"}
ALL_LIGHTS_NAMES = {"light", "lights", "all lights", "all light", "every light", "lighting"}
LIGHT_CUES = {"light", "lights", "lighting", "lamp", "bright", "brighter", "dim", "dimmer", "brightness", "room"}
AC_NAMES = {"ac", "tusker ac", "air conditioner", "air conditioning", "air con", "experience center ac", "aircon"}
AC_CUES = {"ac", "air", "conditioner", "conditioning", "aircon", "temperature", "degrees", "degree", "cool", "heat",
           "warmer", "cooler", "hot", "cold", "warm", "celsius", "fan"}
VOLUME_CUES = {"volume", "louder", "quieter", "sound", "mute", "unmute", "loud", "quiet", "softer", "up", "down", "audio"}
TV_CUES = {"tv", "television", "tusker", "86", "screen", "display"}
LOCK_CUES = {"lock", "close", "secure", "shut", "locked"}
UNLOCK_CUES = {"unlock", "open", "release", "let", "unlocked"}
NIGHT_CUES = {"bye", "goodbye", "night", "everything", "shut", "done", "finished", "all"}
MORNING_CUES = {"morning", "everything", "start", "hi", "hello", "all", "begin"}

# "off the light" is one light, so ask which; "the lights", "all lights", "light up the room" mean all of them.
ALL_LIGHTS_WORDS = {"lights", "all", "every", "everything", "room", "up"}


def _single_light_said(utoks: set[str]) -> bool:
    return "light" in utoks and not utoks & ALL_LIGHTS_WORDS


LIGHT_ACTIONS = {"lights_on", "lights_off", "lights_set", "status"}
AC_COMMANDS = {"power_on", "power_off", "set_temp", "set_mode", "set_fan"}


@dataclass
class Prepared:
    calls: list[tuple[str, dict]] = field(default_factory=list)
    question: str | None = None  # set => nothing is sent; this is what to say
    note: str = ""  # why, for the model's retry
    scope: str | None = None  # "all lights" when one plural request became several calls


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).strip().rstrip("%"))
    except (TypeError, ValueError):
        return None


class ActionGuard:
    def __init__(self, registry: Registry, ttl: float = 120.0):
        self._registry = registry
        self._ttl = ttl
        self._ctx: dict[str, tuple[str, float]] = {}
        self.light_names = [k for k in (registry.slots.get("light") or {}).get("values", {})]
        self.screen_names = [k for k in (registry.slots.get("screenAlias") or {}).get("values", {})]
        # alias phrase -> canonical, for names said the short way ("l 3" for "tusker L3")
        self._aliases: list[tuple[str, str]] = []
        for slot in ("light", "screenAlias", "ambientMode"):
            for alias_tokens, value in registry.enum_aliases.get(slot, []):
                self._aliases.append((" ".join(alias_tokens), normalize(value)))

    # ── context: what "it" can mean ──────────────────────────────────────
    def reset(self) -> None:
        self._ctx.clear()

    def _fresh(self, kind: str) -> str | None:
        item = self._ctx.get(kind)
        if item and time.monotonic() - item[1] <= self._ttl:
            return item[0]
        return None

    def age(self, seconds: float) -> None:
        """Pretend `seconds` have passed (tests / benchmark)."""
        self._ctx = {k: (v, t - seconds) for k, (v, t) in self._ctx.items()}

    def remember_scope(self, kind: str, value: str) -> None:
        """"them" after "the lights to 80%" is all the lights, not the last one changed."""
        self._ctx[kind] = (value, time.monotonic())

    def remember(self, name: str, args: dict, ok: bool) -> None:
        if not ok:
            return
        now = time.monotonic()
        if name == "device_control":
            a = str(args.get("action", "")).lower()
            t = normalize(str(args.get("target") or ""))
            if a in ("all_lights_on", "all_lights_off"):
                self._ctx["light"] = ("all lights", now)
            elif a in LIGHT_ACTIONS and t:
                self._ctx["light"] = (t, now)
            elif a == "ac_command" and str(args.get("command", "")).lower() in AC_COMMANDS:
                self._ctx["ac"] = ("ac", now)
        elif name == "screen_control":
            s = normalize(str(args.get("screen") or ""))
            if s:
                self._ctx["screen"] = (s, now)

    def context_line(self) -> str:
        bits = []
        for kind, label in (("light", "lights"), ("ac", "AC"), ("screen", "screen")):
            v = self._fresh(kind)
            if v:
                bits.append(f"{label} = {v}")
        return "Last used: " + "; ".join(bits) + "." if bits else ""

    # ── grounding ────────────────────────────────────────────────────────
    def _said(self, value: str, utterance: str) -> bool:
        """The name was spoken: as is, as an alias of what was spoken, or close to it."""
        v, u = normalize(value), normalize(utterance)
        if not v:
            return False
        padded = f" {u} "
        if f" {v} " in padded:
            return True
        for alias, canonical in self._aliases:
            if canonical == v and f" {alias} " in padded:
                return True
        words, uw = v.split(), u.split()
        n = len(words)
        for i in range(0, max(1, len(uw) - n + 1)):
            window = " ".join(uw[i : i + n])
            # "tusker l3" is one letter from "tusker l1", but it is a different light.
            if re.findall(r"\d+", window) == re.findall(r"\d+", v) and similarity(v, window) >= 0.78:
                return True
        return False

    def _names_a_light(self, utterance: str) -> bool:
        padded = f" {normalize(utterance)} "
        return any(f" {alias} " in padded for alias, canon in self._aliases if canon in {normalize(n) for n in self.light_names})

    @staticmethod
    def _numbers(utterance: str) -> set[float]:
        return {float(t) for t in normalize(utterance).split() if t.isdigit()}

    def _ask_light(self) -> str:
        names = ", ".join(self.light_names[:-1]) + (f" or {self.light_names[-1]}" if len(self.light_names) > 1 else "")
        return f"Which light do you mean: {names}?" if self.light_names else "Which light do you mean?"

    def _ask_screen(self) -> str:
        names = " or ".join(self.screen_names)
        return f"Which screen: {names}?" if names else "Which screen do you mean?"

    @staticmethod
    def _unclear() -> str:
        return "I'm not sure what you'd like me to change. Which device or screen do you mean, and what should I do?"

    # ── the checks ───────────────────────────────────────────────────────
    def prepare(
        self,
        name: str,
        args: dict,
        utterance: str,
        light_names: Callable[[], list[str]] | None = None,
        strict: bool = True,
    ) -> Prepared:
        """strict=True for calls the model made (everything must be grounded in the utterance);
        strict=False for calls the command list built from the utterance (values are still checked)."""
        args = dict(args or {})
        if name == "device_control":
            return self._device(args, utterance, light_names, strict)
        if name == "screen_control":
            return self._screen(args, utterance, strict)
        return Prepared(calls=[(name, args)])

    def _device(self, args: dict, utterance: str, light_names, strict: bool) -> Prepared:
        a = str(args.get("action", "")).strip().lower()
        u = normalize(utterance)
        utoks = set(u.split())
        pron = bool(utoks & PRONOUNS)
        ok = lambda calls=None: Prepared(calls=calls or [("device_control", args)])  # noqa: E731
        ask = lambda q, note: Prepared(question=q, note=note)  # noqa: E731

        # --- the AC and the TV remote (ac_command) ------------------------
        if a == "ac_command":
            cmd = str(args.get("command", "")).strip().lower()
            params = dict(args.get("params") or {})
            if cmd in AC_COMMANDS:
                args["target"] = "ac"  # whatever the model called it, this is the AC
                if strict and not (utoks & AC_CUES) and not (pron and self._fresh("ac")):
                    return ask(self._unclear(), "no AC was mentioned")
                if strict and self._names_a_light(utterance) and not (utoks & {"ac", "air", "conditioner", "conditioning", "aircon", "temperature"}):
                    return ask("Do you mean a light or the AC? Say which one, and what to set.", "a light was named but the AC was changed")
                nums = self._numbers(utterance)
                if cmd == "set_temp":
                    t = _num(params.get("temp"))
                    if strict and ("percent" in utoks and not utoks & {"degrees", "degree", "celsius"}):
                        return ask(f"The AC is set in degrees, from {AC_MIN_TEMP} to {AC_MAX_TEMP}. What temperature would you like?", "a percentage was said for the AC")
                    if t is None or (strict and t not in nums):
                        return ask(f"What temperature would you like, from {AC_MIN_TEMP} to {AC_MAX_TEMP} degrees?", "temperature not said")
                    if not AC_MIN_TEMP <= t <= AC_MAX_TEMP:
                        return ask(f"The AC goes from {AC_MIN_TEMP} to {AC_MAX_TEMP} degrees. What temperature would you like?", "temperature out of range")
                    params["temp"] = int(t)
                if cmd == "set_mode":
                    m = str(params.get("mode", "")).lower()
                    if m not in AC_MODES or (strict and m not in utoks and m + "ing" not in utoks):
                        return ask(f"The AC modes are {', '.join(AC_MODES[:-1])} and {AC_MODES[-1]}. Which one would you like?", "mode not said")
                if cmd == "set_fan":
                    f = str(params.get("fan", "")).lower()
                    if f not in AC_FANS or (strict and f not in utoks and not (f == "mid" and "medium" in utoks)):
                        return ask(f"The fan speeds are {', '.join(AC_FANS[:-1])} and {AC_FANS[-1]}. Which one would you like?", "fan speed not said")
                if params:
                    args["params"] = params
                return ok()
            if cmd.replace(" ", "") in ("volumeup", "volumedown", "mute", "unmute", "volup", "voldown"):
                if strict and not (utoks & VOLUME_CUES):
                    return ask(self._unclear(), "volume was not mentioned")
                times = _num(params.get("times"))
                said = self._numbers(utterance)
                if strict and len(said) == 1 and not (utoks & AC_CUES) and not (utoks & LIGHT_CUES) and not 1 <= next(iter(said)) <= MAX_VOLUME_STEPS:
                    return ask(f"I can change the volume by 1 to {MAX_VOLUME_STEPS} steps at a time. How many steps?", "spoken volume steps out of range")
                if times is not None and not 1 <= times <= MAX_VOLUME_STEPS:
                    return ask(f"I can change the volume by 1 to {MAX_VOLUME_STEPS} steps at a time. How many steps?", "volume steps out of range")
                if times is not None:
                    params["times"] = int(times)
                    args["params"] = params
                return ok()
            if cmd == "power":
                t = normalize(str(args.get("target") or ""))
                if strict and not (utoks & TV_CUES):
                    return ask(self._unclear(), "the TV was not mentioned")
                return ok()
            return ok()  # any other remote key: the CMS knows its button names

        # --- lights: on / off / set / status ------------------------------
        if a in LIGHT_ACTIONS:
            t = normalize(str(args.get("target") or ""))
            if a == "status" and t in {normalize(x) for x in AC_NAMES}:
                if strict and not (utoks & AC_CUES) and not (pron and self._fresh("ac")):
                    return ask(self._unclear(), "no AC was mentioned")
                return ok()
            if not t or t in PLACEHOLDERS:
                ctx = self._fresh("light")
                if ctx and pron:
                    t = ctx
                    args["target"] = ctx
                elif utoks & {"light", "lights"}:
                    t = "lights"  # "the lights" with no name means all of them
                    args["target"] = "lights"
                else:
                    return ask(self._ask_light(), "no device was named")
            if a != "status" and t in {normalize(x) for x in AC_NAMES}:
                return ask(self._ask_light(), "the AC is not a light")
            all_lights = t in ALL_LIGHTS_NAMES
            if all_lights and _single_light_said(utoks):
                return ask(self._ask_light(), "one light was said without a name")
            if a == "lights_set":
                nums = self._numbers(utterance)
                if strict and utoks & {"degrees", "degree", "celsius"}:
                    return ask("Brightness is a percentage from 0 to 100, not degrees. What level would you like?", "degrees were said for a light")
                br = _num(args.get("brightness"))
                color = str(args.get("color") or "").strip()
                br_ok = br is not None and (not strict or br in nums)
                color_ok = bool(color) and (not strict or self._said(color, utterance) or normalize(color).replace("light", "").strip() in u)
                if br is not None and not 0 <= br <= 100 and (br_ok or not strict):
                    return ask("Brightness goes from 0 to 100 percent. What level would you like?", "brightness out of range")
                if br_ok and color and not color_ok:
                    args.pop("color", None)  # the model added a colour nobody asked for
                elif color_ok and br is not None and not br_ok:
                    args.pop("brightness", None)  # ...or a level nobody asked for
                elif not br_ok and not color_ok:
                    return ask("What brightness would you like, from 0 to 100 percent, or which colour?", "no level or colour was said")
                if "brightness" in args:
                    args["brightness"] = int(br)  # type: ignore[arg-type]
            if all_lights:
                if strict and not (utoks & LIGHT_CUES) and not (pron and self._fresh("light") == "all lights"):
                    return ask(self._unclear(), "lights were not mentioned")
                if a == "lights_on":
                    return ok([("device_control", {"action": "all_lights_on"})])
                if a == "lights_off":
                    return ok([("device_control", {"action": "all_lights_off"})])
                names = light_names() if light_names else list(self.light_names)
                if not names:
                    return ask(self._ask_light(), "could not list the lights")
                p = ok([("device_control", {**args, "target": n}) for n in names])
                p.scope = "all lights"
                return p
            if strict and not (self._said(t, utterance) or (pron and self._fresh("light") == t)):
                return ask(self._ask_light(), f"'{t}' was not said")
            return ok()

        # --- scenes and the door ------------------------------------------
        if a in ("all_lights_on", "all_lights_off") and _single_light_said(utoks):
            return ask(self._ask_light(), "one light was said without a name")
        cues = {"lock": LOCK_CUES, "unlock": UNLOCK_CUES, "good_night": NIGHT_CUES, "good_morning": MORNING_CUES,
                "all_lights_on": LIGHT_CUES, "all_lights_off": LIGHT_CUES}.get(a)
        if cues is not None and strict:
            if not (utoks & cues) and not (a.startswith("all_lights") and pron and self._fresh("light") == "all lights"):
                return ask(self._unclear(), f"nothing in the request asked for {a}")
        if a == "ambient_mode" and strict:
            t = str(args.get("target") or "")
            # "show the presentation" is not "presentation mode": the word "mode" is the cue
            if not t or not self._said(t, utterance) or not (utoks & {"mode", "ambient"}):
                modes = "pre-entry, entry, meeting or presentation"
                return ask(f"Which mode: {modes}?", "no mode was said")
        return ok()

    def _screen(self, args: dict, utterance: str, strict: bool) -> Prepared:
        a = str(args.get("action", "")).strip().lower()
        u = normalize(utterance)
        pron = bool(set(u.split()) & PRONOUNS)
        ask = lambda q, note: Prepared(question=q, note=note)  # noqa: E731
        s = normalize(str(args.get("screen") or ""))
        if not s or s in PLACEHOLDERS:
            ctx = self._fresh("screen")
            if ctx and (pron or not strict):
                args["screen"] = ctx
            else:
                return ask(self._ask_screen(), "no screen was named")
        elif strict and not (self._said(s, utterance) or (pron and self._fresh("screen") == s)):
            return ask(self._ask_screen(), f"'{s}' was not said")
        if a in ("assign_experience", "assign_media", "assign_content"):
            c = str(args.get("content") or "")
            if not normalize(c):
                return ask("Which experience or media item do you mean?", "no content was named")
            if strict and not self._said(c, utterance):
                return ask("Which experience or media item do you mean?", f"'{c}' was not said")
        return Prepared(calls=[("screen_control", args)])
