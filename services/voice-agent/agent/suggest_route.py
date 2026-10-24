"""A statement about the room ("it's too cold in here", "I can't hear anything"): proposed, not done.

The planner says which way the room should change (`kind: "suggest"`, nlu/plan.py). nlu/suggest.py picks one concrete change from what the CMS reports
or a configured default; this asks "Would you like me to ...?" and keeps the exact calls as an offer (the same yes/no step as every other offer,
agent/commands.py `_confirm_step`). Nothing reaches the CMS before the visitor says yes. With no sensible target, the normal question for that kind of
change is asked instead ("What temperature would you like?") and its answer completes it.
"""

from __future__ import annotations

import asyncio

from actions import cms_client
from nlu import title_match
from nlu.plan import Action, Plan, Target, quote_supported
from nlu.suggest import propose
from settings import load_api_config

_ASK_INSTEAD = {  # the open question for a need that has no sensible proposal: the change with no value, which asks for it and waits for the answer
    "warmer": Action("ac_adjust", Target(type="ac", scope="none"), {}),
    "cooler": Action("ac_adjust", Target(type="ac", scope="none"), {}),
    "brighter": Action("light_adjust", Target(type="light", scope="all", words="the lights"), {}),
    "dimmer": Action("light_adjust", Target(type="light", scope="all", words="the lights"), {}),
}


class SuggestMixin:
    async def _suggest(self, plan: Plan, request: str, ask_only: bool = False) -> str | None:
        """The spoken proposal (or question) for a statement, or None if the planner's reading is not backed by the words (the normal route then answers).
        `ask_only`: the sentence is really a request without a value ("make it warmer"): no default is proposed, the value is asked for."""
        if not quote_supported(plan.need_quote, request):
            print(f"[Voice Agent] 🧭 A suggestion whose words were not said ({plan.need_quote!r}); the model answers instead.")
            return None
        loop = asyncio.get_running_loop()
        devices: list[dict] = []
        if not ask_only:
            try:
                devices = await loop.run_in_executor(None, lambda: cms_client.list_devices(fresh=True))
            except Exception as e:  # without the CMS there is no state to base a proposal on
                print(f"[Voice Agent] ⚠️ Suggestion without CMS state ({e}).")
        proposal = None if ask_only else propose(plan.need, devices or [], load_api_config())
        self._plan_log = {**(self._plan_log or {}), "suggest": {"need": plan.need, "offer": proposal.offer if proposal else None}}
        if proposal is None:
            ask = _ASK_INSTEAD.get(plan.need)
            if ask is None:
                return None
            self._path = "suggestion (asked)"
            from dataclasses import replace

            synthetic = Plan("actions", [replace(ask, quote=plan.need_quote)])
            await loop.run_in_executor(None, self._refresh_world)
            return await self._execute_compiled(self.compile_plan(synthetic, request))
        first, *more = proposal.calls
        self._confirm = title_match.Confirm(
            [title_match.Candidate("command", proposal.offer, 1.0, first[0], first[1], also=list(more), trusted=True)], proposal.offer, offer=True)
        hint = "" if float(load_api_config().get("followup_window_sec", 8) or 0) else f" Say {self._wake_hint}, yes or no."
        reply = f"{proposal.basis} Would you like me to {proposal.offer}?{hint}".strip()
        self._path = "suggestion (offered)"
        print(f"[Voice Agent] 💡 A statement, not a request ({plan.need}): offering {proposal.offer!r}.")
        await self._say(reply)
        return reply
