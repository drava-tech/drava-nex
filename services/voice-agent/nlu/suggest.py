"""A statement about the room ("it's too cold in here", "I can't hear anything") becomes a PROPOSAL, never an action.

The planner only says which way the room should change (`need`, nlu/plan.py). Here, plain code picks one concrete change from what the CMS reports
(current AC temperature, which lights are on and how bright) or from a configured default (`comfort_temp`, `comfort_light_up`, `comfort_light_down`),
and agent/suggest_route.py asks "Would you like me to ...?". Nothing runs until the visitor says yes.

Nothing is invented: a current value is only mentioned when the CMS reported it, a device with no readback (the volume) gets "I can't check ...", and when
no sensible target exists `propose` returns None so the caller asks a short question instead.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from nlu import capabilities
from nlu.plan import OPS
from nlu.room_state import find_ac, lights
from safety.action_guard import AC_MAX_TEMP, AC_MIN_TEMP

DEFAULTS = {"comfort_temp": 24, "comfort_light_up": 80, "comfort_light_down": 40}
VOLUME_STEPS = 3  # a normal "turn it up" (the planner's default for volume_up / volume_down)
AC_STEP = 2  # when the AC is already at or past the comfort temperature and the visitor still wants it warmer / cooler


@dataclass
class Proposal:
    offer: str  # the change as a verb phrase: "raise the AC temperature to 24 degrees"; spoken as "Would you like me to <offer>?"
    calls: list[tuple[str, dict]]  # what a yes runs, built from the same OPS the planner uses
    basis: str = field(default="")  # what the CMS reported, or what cannot be checked, said before the offer


def _call(op: str, **extra) -> tuple[str, dict]:
    tool, base = OPS[op]
    return tool, {**base, **extra}


def _setting(cfg: dict, key: str) -> int:
    try:
        return int(cfg.get(key, DEFAULTS[key]))
    except (TypeError, ValueError):
        return DEFAULTS[key]


def _ac(need: str, devices: list[dict], cfg: dict) -> Proposal | None:
    comfort = min(max(_setting(cfg, "comfort_temp"), AC_MIN_TEMP), AC_MAX_TEMP)
    ac = find_ac(devices)
    state = (ac or {}).get("state") or {}
    if "power" in state and not state.get("power"):
        return None  # the CMS says the AC is off: raising or lowering a setting is not what this visitor needs, so ask
    current = state.get("temp") if state.get("power") and isinstance(state.get("temp"), (int, float)) and state.get("temp") else None
    warmer = need == "warmer"
    basis = ""
    if current is None:
        target = comfort  # the CMS has no temperature for the AC: the configured default
    else:
        current = int(current)
        if warmer:
            target = comfort if current < comfort else min(current + AC_STEP, AC_MAX_TEMP)
        else:
            target = comfort if current > comfort else max(current - AC_STEP, AC_MIN_TEMP)
        if target == current:
            return None  # already at the limit in that direction
        basis = f"The AC is set to {current} degrees."
    return Proposal(f"{'raise' if warmer else 'lower'} the AC temperature to {target} degrees", [_call("ac_set_temperature", target="ac", params={"temp": target})], basis)


def _lights(need: str, devices: list[dict], cfg: dict) -> Proposal | None:
    ls = lights(devices)
    on = [x for x in ls if x["on"]]
    levels = [x["level"] for x in on if isinstance(x.get("level"), (int, float))]
    if need == "brighter":
        if ls and not on:
            return Proposal("turn the lights on", [("device_control", {"action": "all_lights_on"})], "The lights are off.")
        up = _setting(cfg, "comfort_light_up")
        if on and levels and len(levels) == len(on) and max(levels) < up:
            return Proposal(f"set the lights to {up} percent", [_call("light_set", target="lights", brightness=up)])
        return None
    down = _setting(cfg, "comfort_light_down")
    if on and levels and len(levels) == len(on) and max(levels) > down:
        return Proposal(f"set the lights to {down} percent", [_call("light_set", target="lights", brightness=down)])
    return None


def _volume(need: str) -> Proposal:
    op = "volume_up" if need == "louder" else "volume_down"
    return Proposal(f"turn the volume {'up' if need == 'louder' else 'down'}", [_call(op, params={"times": VOLUME_STEPS})],
                    "I can't check the current sound level." if not capabilities.can_read("volume") else "")


def propose(need: str, devices: list[dict], cfg: dict | None = None) -> Proposal | None:
    """One concrete change for `need`, or None when nothing sensible follows from what the CMS reports and the defaults (the caller then asks)."""
    cfg = cfg or {}
    if need in ("warmer", "cooler"):
        return _ac(need, devices, cfg)
    if need in ("brighter", "dimmer"):
        return _lights(need, devices, cfg)
    if need in ("louder", "quieter"):
        return _volume(need)
    return None
