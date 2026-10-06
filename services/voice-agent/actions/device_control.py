"""Voice tool: physical device control (lights, AC/IR, door lock).

Talks to this platform's existing device drivers (Casambi lights, Tuya IR/AC,
Home Assistant lock) through its internal voice API — see
apps/api/src/routes/voice-internal.ts and apps/api/src/services/voice-actions.ts.
This voice agent never talks to the hardware directly; it is purely a voice
front end onto controls the CMS already has.

Name resolution ("the lobby lights") happens server-side in cms-platform, not
here — this module just forwards the spoken target and speaks back whatever
message (including a clarifying question for an ambiguous target) the CMS
decided on.
"""

from __future__ import annotations

from . import cms_client
from .cms_client import CmsClientError


def _clean_params(raw: object) -> dict | None:
    """Strip stray quote characters Gemini has been observed wrapping around
    keys in this free-form OBJECT field (e.g. {'"temp"': 25} instead of
    {"temp": 25}) — a model quirk, not something callers should have to work
    around downstream. Kept even after giving `params` an explicit
    sub-schema in main.py's TOOL_DECLARATIONS, as a cheap safety net.
    """
    if not isinstance(raw, dict):
        return None
    return {str(k).strip("\"'"): v for k, v in raw.items()}


# Short-term context memory: the last device this process successfully acted
# on, so a follow-up like "turn it off" or "dim it to 50%" still works even
# if the model doesn't substitute the real name itself (the primary
# mechanism is a prompt instruction telling it to — see nlu/prompt_local.txt —
# this is a safety net for when it forgets or omits target entirely). Process-
# lifetime only: cleared by nothing, so it always reflects whatever was acted
# on most recently, across wake cycles, which matches how a real assistant's
# short-term memory should behave within one running session.
_last_device_target: str | None = None

# Actions with no per-device target concept — never eligible for the fallback.
_NO_TARGET_ACTIONS = {
    "lock",
    "unlock",
    "good_night",
    "good_morning",
    "ambient_mode",
    "all_lights_on",
    "all_lights_off",
}


def device_control(parameters: dict, player=None, speak=None) -> str:
    """Control a physical device (lights, AC/IR, door lock) by voice.
    Returns what to say: the CMS's message, or why it failed."""
    return run_device_control(parameters)[1]


def run_device_control(parameters: dict) -> tuple[bool, str]:
    """device_control, plus whether the CMS actually did it (False = the
    message is an error or a question). The local fast path needs the
    difference: it speaks its own short confirmation only on success.

    parameters:
        action (str): lights_on | lights_off | lights_set | scene_recall |
                      ac_command | lock | unlock | status | good_night |
                      good_morning | ambient_mode | all_lights_on |
                      all_lights_off
        target (str): device or room name, e.g. "lobby lights"; for
                      ambient_mode, the mode name as said. Not needed for
                      lock/unlock/good_night/good_morning/all_lights_on/
                      all_lights_off
        brightness (int): 0-100, for lights_set
        color (str): for lights_set
        command (str): AC/IR codebook verb, e.g. "power_on" | "power_off" |
                       "set_temp" | "set_mode" | "set_fan" — for ac_command
        params (dict): extra args for ac_command, e.g. {"temp": 22}
    """
    global _last_device_target

    params = parameters or {}
    action = str(params.get("action", "")).strip().lower()
    if not action:
        return False, "Which device action did you mean — turn something on, off, or change a setting?"

    target = params.get("target")
    if not target and action not in _NO_TARGET_ACTIONS and _last_device_target:
        target = _last_device_target

    try:
        result = cms_client.device_command(
            action=action,
            target=target,
            brightness=params.get("brightness"),
            color=params.get("color"),
            command=params.get("command"),
            params=_clean_params(params.get("params")),
        )
    except CmsClientError as e:
        return False, str(e)

    resolved = result.get("resolvedTarget")
    # A mode is not a device: remembering "Meeting mode" here would make a
    # follow-up "turn it off" try to switch off a device by that name.
    if resolved and action != "ambient_mode":
        _last_device_target = resolved

    return True, result.get("message") or "Done."
