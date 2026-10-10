"""Voice tool: answer "what screens/devices exist" with the CMS's real,
current inventory — not the static knowledge base, which only covers
documentation the operator wrote by hand and can go stale or stay generic.
Uses the same cached list_screens()/list_devices() cms_client already
exposes for internal name resolution, previously never wired up to anything
the model could call directly.
"""

from __future__ import annotations

from . import cms_client
from .cms_client import CmsClientError
from nlu.spoken_names import HIDDEN_FROM_LISTS, say_names


def _join(names: list[str]) -> str:
    """"a", "a and b", "a, b and c": the way a person lists things."""
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + f" and {names[-1]}"


def _the(name: str) -> str:
    """"the cove light", but "the AC" and "the TV" only when it reads as a thing, never "the tusker 86"."""
    name = say_names(name)  # "tusker edge" is "the cove light" out loud
    low = name.lower()
    return name if low.startswith(("the ", "tusker ")) or low == "facade" else f"the {name}"


def _format_names(items: list[dict], name_key: str, article: bool = False) -> str:
    names = [str(i.get(name_key, "")).strip() for i in items if i.get(name_key)]
    if not names:
        return "nothing"
    return _join([_the(n) if article else n for n in names])


def list_inventory(parameters: dict, player=None, speak=None) -> str:
    """List the CMS's real, current screens and/or devices.

    parameters:
        kind (str): "screens" | "devices" | "both" — defaults to "both"
    """
    kind = str((parameters or {}).get("kind", "both")).strip().lower()
    if kind in ("light", "lights"):
        kind = "lights"
    if kind not in ("screens", "devices", "lights", "both"):
        kind = "both"

    parts = []
    try:
        if kind in ("screens", "both"):
            screens = cms_client.list_screens()
            parts.append(("screens", len(screens), _format_names(screens, "screenName")))
        if kind == "lights":
            lights = [d for d in cms_client.list_devices() if d.get("type") == "light"]
            have = {str(d.get("name", "")).strip().lower() for d in lights}
            has_sky = {"tusker l1", "tusker l2"} <= have
            lights = [d for d in lights if str(d.get("name", "")).strip() not in HIDDEN_FROM_LISTS]
            if has_sky and "tusker l3" not in have:
                lights.append({"name": "tusker L3"})
            if not lights:
                return "I can't see any lights right now."
            n = len(lights)
            count = "one light" if n == 1 else {2: "two", 3: "three", 4: "four"}.get(n, str(n)) + " lights"
            return say_names(f"I can control {count}: {_format_names(lights, 'name', article=True)}.")
        if kind in ("devices", "both"):
            # The soundbar is never offered: volume goes through the TV's remote.
            devices = [d for d in cms_client.list_devices() if "soundbar" not in str(d.get("name", "")).lower()]
            # "tusker L3" is not a device: it is L1 and L2 together, and can be said like one.
            # The sky light is one thing to a visitor: its front and back halves are not listed.
            have = {str(d.get("name", "")).strip().lower() for d in devices}
            has_sky = {"tusker l1", "tusker l2"} <= have
            devices = [d for d in devices if str(d.get("name", "")).strip() not in HIDDEN_FROM_LISTS]
            if has_sky and "tusker l3" not in have:
                devices.append({"name": "tusker L3"})
            parts.append(("devices", len(devices), _format_names(devices, "name", article=True)))
    except CmsClientError as e:
        return str(e)

    said = []
    for kind_, n, names in parts:
        if kind_ == "screens":
            said.append(f"There {'is one screen' if n == 1 else 'are ' + str(n) + ' screens'}: {names}.")
        else:
            said.append(f"I can control {names}.")
    return say_names(" ".join(said))
