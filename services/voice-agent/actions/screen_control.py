"""Voice tool: CMS screen/content control.

Push an experience or media item to a named screen, reset it to idle, or
drive its playback (play/pause/seek/queue/reset-view) — through the same
internal voice API device_control.py uses (see
apps/api/src/routes/voice-internal.ts and apps/api/src/services/voice-actions.ts).
This voice agent never writes to the database directly; every action here
does exactly what an operator's equivalent click in the CMS's per-screen
control panel already does (same remote-command channel, same broadcasts).
Deliberately NOT exposed here: the kiosk-process controls next to those
buttons in the CMS (refresh/minimize/maximize/close the app) and any
camera/admin-only action — those aren't content control and are too risky
to leave reachable by an unauthenticated room mic.
"""

from __future__ import annotations

from . import cms_client
from .cms_client import CmsClientError

# Short-term context memory: the last screen this process successfully acted
# on, so a follow-up like "set it to idle" or "same thing on that one" still
# works even if the model doesn't substitute the real name itself — same
# reasoning and same process-lifetime scope as device_control.py's
# _last_device_target.
_last_screen_target: str | None = None


def screen_control(parameters: dict, player=None, speak=None) -> str:
    """Control what a screen is showing, by voice.

    parameters:
        action (str): assign_experience | assign_media | idle | stop | status |
                      play | pause | seek_forward | seek_back |
                      next_item | previous_item | reset_view
        screen (str): screen name or id as the user said it. Optional — when
                      omitted, the screen last acted on is reused, else the
                      user is asked (with the real screen names).
        content (str): experience or media name — required for
                       assign_experience/assign_media
    """
    global _last_screen_target

    params = parameters or {}
    action = str(params.get("action", "")).strip().lower()
    screen = str(params.get("screen", "")).strip()
    if not action:
        return "Which screen action did you mean — push content, or set it to idle?"
    if not screen:
        if _last_screen_target:
            screen = _last_screen_target
        else:
            # Name the real screens: left to itself the model offers made-up
            # ones ("the Lobby Screen") lifted from its own example phrases.
            try:
                names = [
                    str(s["screenName"])
                    for s in cms_client.list_screens()
                    if s.get("screenName")
                ]
            except CmsClientError:
                names = []
            if names:
                return (
                    "Which screen did you mean? The screens are: "
                    + ", ".join(names)
                    + ". Only offer these."
                )
            return "Which screen did you mean?"

    try:
        result = cms_client.screen_command(
            action=action,
            screen=screen,
            content=params.get("content"),
        )
    except CmsClientError as e:
        return str(e)

    resolved = result.get("resolvedTarget")
    if resolved:
        _last_screen_target = resolved

    return result.get("message") or "Done."
