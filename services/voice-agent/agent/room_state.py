"""The room-state route: "Is the AC on?", "Which lights are on?", "What is playing on the main screen?" answered from live CMS data.

Runs in agent/planning.py when the planner says the sentence is not a room command and not a question about the company, the CMS or Travis.
Read-only: the only CMS calls are the two list reads (devices, screens); nothing here can change a device, lock or unlock the door, or push
content. The classifier is the local model (nlu/room_state.py); the reply is built by code from the CMS lists. If the classifier does not see
a state question, or the CMS cannot be read, this returns None / says so and the normal route goes on.
"""

from __future__ import annotations

import asyncio

from actions import cms_client
from agent import fallback_stats
from nlu import room_state
from settings import load_api_config

MIN_WORDS = 3
_UNREACHABLE = "I couldn't reach the CMS, so I can't tell you that right now."


class RoomStateMixin:
    async def _answer_room_state(self, request: str) -> str | None:
        """The spoken answer to a question about the room right now, or None if `request` is not one. A fragment ("The AC.") is not a question:
        it is left to the normal route, which asks what is wanted."""
        fallback_stats.note("fallback_turns")
        if len(request.split()) < MIN_WORDS:
            fallback_stats.note("room_state.skipped_fragment")
            return None
        if not room_state.could_be_state_question(request):
            fallback_stats.note("room_state.skipped_shape")  # a change, or not shaped like a question: no 0.6 s model call to find out
            return None
        floor = float(load_api_config().get("room_state_min_similarity", room_state.MIN_SIMILARITY))
        if floor > 0:
            try:
                close = await asyncio.get_running_loop().run_in_executor(None, room_state.similarity_to_state_questions, request)
            except Exception:  # no embedding: ask the classifier, as before
                close = 1.0
            if close < floor:
                fallback_stats.note("room_state.skipped_embedding")  # shaped like a question, but unlike any question about the room
                return None
        fallback_stats.note("room_state.asked")
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
                devices = await loop.run_in_executor(None, lambda: cms_client.list_devices(fresh=True))
            if q.subject in ("tv", "screens"):
                screens = await loop.run_in_executor(None, lambda: cms_client.list_screens(fresh=True))
                if q.subject == "tv":
                    devices = await loop.run_in_executor(None, lambda: cms_client.list_devices(fresh=True))
            reply = room_state.answer(q, devices or [], screens or [])
        except Exception as e:
            print(f"[Voice Agent] ⚠️ Room-state read failed: {e}")
            reply = _UNREACHABLE
        self._calls_log.append({"name": "room_state", "args": {"subject": q.subject, "question": q.question}, "ok": reply != _UNREACHABLE, "message": reply})
        await self._say(reply)
        return reply
