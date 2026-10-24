"""A short spoken description of the calls a request would make, so Travis can ask "Did you mean turn on all the lights?".

Used when the speech model is not sure what was said (agent/commands.py `_offer_guess`): the calls come from the normal understanding steps
(`_calls_for`, which never runs anything), and this turns them back into words. The words use the room's own names (nlu/spoken_names.py) and
carry every number and name the calls hold, because a "yes" runs those exact calls and the action guard checks the offer text for them.

`say_calls` returns None when any call is not one it can describe in a plain sentence; the caller then asks for the request again.
"""

from __future__ import annotations

from nlu.spoken_names import say_names


def _target(args: dict) -> str:
    return say_names(str(args.get("target") or "").strip())


def _lights(args: dict) -> str | None:
    action = str(args.get("action", ""))
    if action == "all_lights_on":
        return "turn on all the lights"
    if action == "all_lights_off":
        return "turn off all the lights"
    target = _target(args)
    if not target:
        return None
    if action in ("lights_on", "lights_off"):
        return f"turn {'on' if action == 'lights_on' else 'off'} the {target}"
    if action == "lights_set":
        bits = []
        if isinstance(args.get("brightness"), (int, float)):
            bits.append(f"{int(args['brightness'])} percent")
        if args.get("color"):
            bits.append(str(args["color"]))
        return f"set the {target} to {' and '.join(bits)}" if bits else None
    return None


def _ac(args: dict) -> str | None:
    command = str(args.get("command", ""))
    if command == "power_on":
        return "turn on the AC"
    if command == "power_off":
        return "turn off the AC"
    if command == "set_temp":
        temp = (args.get("params") or {}).get("temp", args.get("temp"))
        return f"set the AC to {int(temp)} degrees" if isinstance(temp, (int, float)) else None
    if command in ("Volume Up", "Volume Down"):
        return f"turn the volume {'up' if command == 'Volume Up' else 'down'}"
    if command == "mute":
        return "mute the sound"
    return None


def _screen(args: dict) -> str | None:
    action = str(args.get("action", ""))
    screen = say_names(str(args.get("screen") or "").strip())
    content = say_names(str(args.get("content") or "").strip())
    if action in ("assign_experience", "assign_media", "assign_content"):
        return f"show {content} on {screen}" if content and screen else None
    if action == "stop":
        return f"stop {screen}" if screen else None
    if action == "reset_view":
        return f"reset the view on {screen}" if screen else "reset the view"
    return None


def say_call(tool: str, args: dict) -> str | None:
    if tool == "device_control":
        if str(args.get("action", "")) == "ac_command":
            return _ac(args)
        return _lights(args)
    if tool == "screen_control":
        return _screen(args)
    return None


def say_calls(calls: list[tuple[str, dict]]) -> str | None:
    """"turn on all the lights", "turn off the cove light and set the sky light to 50 percent", or None if any call can't be said plainly."""
    parts = [say_call(tool, args) for tool, args in calls]
    if not parts or any(p is None for p in parts):
        return None
    return " and ".join(p for p in parts if p)
