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


def _format_names(items: list[dict], name_key: str) -> str:
    names = [str(i.get(name_key, "")).strip() for i in items if i.get(name_key)]
    if not names:
        return "none"
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + f", and {names[-1]}"


def list_inventory(parameters: dict, player=None, speak=None) -> str:
    """List the CMS's real, current screens and/or devices.

    parameters:
        kind (str): "screens" | "devices" | "both" — defaults to "both"
    """
    kind = str((parameters or {}).get("kind", "both")).strip().lower()
    if kind not in ("screens", "devices", "both"):
        kind = "both"

    parts = []
    try:
        if kind in ("screens", "both"):
            screens = cms_client.list_screens()
            parts.append(
                f"{len(screens)} screen{'s' if len(screens) != 1 else ''}: {_format_names(screens, 'screenName')}"
            )
        if kind in ("devices", "both"):
            # The soundbar is never offered: volume goes through the TV's remote.
            devices = [d for d in cms_client.list_devices() if "soundbar" not in str(d.get("name", "")).lower()]
            # "tusker L3" is not a device: it is L1 and L2 together, and can be said like one.
            have = {str(d.get("name", "")).strip().lower() for d in devices}
            if {"tusker l1", "tusker l2"} <= have and "tusker l3" not in have:
                devices.append({"name": "tusker L3, which is L1 and L2 together"})
            parts.append(
                f"{len(devices)} controllable device{'s' if len(devices) != 1 else ''}: {_format_names(devices, 'name')}"
            )
    except CmsClientError as e:
        return str(e)

    return "There are " + "; and ".join(parts) + "."
