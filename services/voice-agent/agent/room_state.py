"""The room-state route: "Is the AC on?", "Which lights are on?", "What is playing on the main screen?" answered from live CMS data.

Runs in agent/planning.py when the planner says the sentence is not a room command and not a question about the company, the CMS or Travis.
Read-only: the only CMS calls are the two list reads (devices, screens); nothing here can change a device, lock or unlock the door, or push
content. The classifier is the local model (nlu/room_state.py); the reply is built by code from the CMS lists. If the classifier does not see
a state question, or the CMS cannot be read, this returns None / says so and the normal route goes on.
"""

from __future__ import annotations

import asyncio

from actions import cms_client
from nlu import room_state

MIN_WORDS = 3
_UNREACHABLE = "I couldn't reach the CMS, so I can't tell you that right now."


class RoomStateMixin:
    async def _answer_room_state(self, request: str) -> str | None:
        """The spoken answer to a question about the room right now, or None if `request` is not one. A fragment ("The AC.") is not a question:
        it is left to the normal route, which asks what is wanted."""
        if len(request.split()) < MIN_WORDS:
            return None
        try:
            raw = await self._llm.complete_json(
                [{"role": "system", "content": room_state.SYSTEM}, {"role": "user", "content": request}], room_state.SCHEMA, max_tokens=90)
        except Exception as e:
            print(f"[Voice Agent] ⚠️ Room-state check failed ({e}); the normal route answers.")
            return None
        q = room_state.parse(raw, request)
        if q is None:
            return None
        print(f"[Voice Agent] 🏠 Room-state question: {q}")
        self._path = "room state"
        self._plan_log = {**(self._plan_log or {}), "room_state": {"subject": q.subject, "question": q.question, "which": q.which}}
        loop = asyncio.get_running_loop()
        devices: list[dict] = []
        screens: list[dict] = []
        try:
            if q.subject in ("lights", "ac", "tv", "volume"):
                devices = await loop.run_in_executor(None, cms_client.list_devices)
            if q.subject in ("tv", "screens"):
                screens = await loop.run_in_executor(None, cms_client.list_screens)
                if q.subject == "tv":
                    devices = await loop.run_in_executor(None, cms_client.list_devices)
            reply = room_state.answer(q, devices or [], screens or [])
        except Exception as e:
            print(f"[Voice Agent] ⚠️ Room-state read failed: {e}")
            reply = _UNREACHABLE
        self._calls_log.append({"name": "room_state", "args": {"subject": q.subject, "question": q.question}, "ok": reply != _UNREACHABLE, "message": reply})
        await self._say(reply)
        return reply
