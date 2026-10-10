"""The planner: the model reads what was MEANT and writes a structured plan (nlu/plan.py).

It replaces matching the sentence against command formats. The model sees the words, the real
names in the room (so it knows what "all the lights" covers), and what was just discussed (so
"them" has something to point at), and answers with a JSON plan constrained to a schema. It does
not choose CMS names and it does not run anything; nlu/resolver.py and agent/planning.py do that.

Public API:
    Planner(chat, system_prompt).plan(request, room, context, history) -> Plan | None
"""

from __future__ import annotations

from nlu.plan import PLAN_SCHEMA, Plan, parse_plan


class Planner:
    """`chat` is an OllamaChat (anything with `async complete_json(messages, schema)`)."""

    def __init__(self, chat, system_prompt: str):
        self._chat = chat
        self._system = system_prompt

    async def plan(self, request: str, room: str, context: str = "", history: list[dict] | None = None) -> Plan | None:
        """None when the model's answer is not a plan; LocalLLMError if the model can't be reached."""
        # The room and context change per request, so they ride with it, after the
        # fixed system prompt and the conversation, to keep the cached prefix intact.
        lines = [f"ROOM:\n{room}"]
        if history:
            # As text, not as chat turns: the model answers in JSON, and a transcript of spoken
            # replies in the assistant role would pull it towards answering in speech.
            said = [f"{'User' if m['role'] == 'user' else 'Travis'}: {m['content']}" for m in history[-6:]]
            lines.append("EARLIER IN THIS CONVERSATION:\n" + "\n".join(said))
        if context:
            lines.append(f"CONTEXT: {context}")
        lines.append(f"REQUEST: {request}")
        messages = [
            {"role": "system", "content": self._system},
            {"role": "user", "content": "\n".join(lines)},
        ]
        return parse_plan(await self._chat.complete_json(messages, PLAN_SCHEMA))
