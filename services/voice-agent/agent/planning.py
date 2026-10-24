"""From a plan to the CMS: target resolution, checks, execution, and what to say.

    request -> Planner (nlu/planner.py) -> Plan -> compile_plan() -> Steps -> CMS (device_control / screen_control)

The model only describes what was meant. Here, the CMS side decides:
  * which real devices/screens a described target is (nlu/resolver.py),
  * whether the values are allowed (a number must have been said and be in range),
  * what runs, and what is said back (the tool results, never the model's words).

Whatever can't be resolved is not guessed: it becomes one natural question naming the real choices,
and the unfinished action waits for the answer (PlanPending). The clear parts of a request still run.

Public API (TravisLocal mixin):
    _run_plan(request, fallback) -> reply     the planner path of one request
    compile_plan(plan, utterance) -> Compiled steps + questions, no side effects (testable)
"""

from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass, field, replace

from actions import cms_client
from types import SimpleNamespace

from nlu import followup, repairs, room_state
from nlu.names import key as name_key, same as same_name
from nlu.command_matcher import match_command, normalize
from nlu.plan import OPS, Action, Plan, Target, quote_supported
from nlu.planner import Planner
from nlu import title_match
from nlu.resolver import ALL, Focus, Resolved, Resolver, points_back
from settings import load_api_config
from nlu.spoken_names import HIDDEN_FROM_LISTS, say_names
from safety.action_guard import AC_FANS, AC_MAX_TEMP, AC_MIN_TEMP, AC_MODES, MAX_VOLUME_STEPS
from safety.reply_guard import ToolResult, compose, with_wake_hint

_PENDING_TTL = 45.0
_LEAD_PARTICLES = {"on", "onto", "in", "to", "at", "the", "a", "put", "it", "use", "for", "yes", "please"}


@dataclass
class Step:
    tool: str
    args: dict
    op: str
    focus: tuple[str, list[str]] | None = None  # what "them" means afterwards: (kind, names)
    group: int = 0  # steps of one planned action (one per light for "them"): reported as one sentence


@dataclass
class PlanPending:
    """An action that only lacked one thing; the next answer ("the kiosk", "70") completes it."""

    action: Action
    missing: str  # screen | light | brightness | temperature
    request: str = ""  # what was said when the question was asked: the action's quote is checked against it
    at: float = field(default_factory=time.monotonic)

    @property
    def fresh(self) -> bool:
        return time.monotonic() - self.at <= _PENDING_TTL


@dataclass
class Compiled:
    steps: list[Step] = field(default_factory=list)
    questions: list[str] = field(default_factory=list)
    pending: PlanPending | None = None
    notes: list[str] = field(default_factory=list)  # how each target was resolved, for the log


def _is_light_op(op: str) -> bool:
    return op.startswith("light_")


def _is_screen_op(op: str) -> bool:
    return op.startswith("screen_")


class PlanMixin:
    """The planner path of TravisLocal. State: `_planner`, `_resolver`, `_focus`, `_plan_pending`."""

    _planner: Planner | None = None
    _resolver: Resolver | None = None
    _plan_pending: PlanPending | None = None
    _plan_log: dict | None = None
    _cu: str = ""
    _off_topic: bool = False
    _group: int = 1

    def _init_planner(self, llm, prompt: str, registry, guard, ttl: float) -> None:
        self._planner = Planner(llm, prompt)
        self._resolver = Resolver(registry, guard.light_names, guard.offered_light_names, guard.screen_names)
        self._focus = Focus(ttl)

    # ── what the planner is shown ────────────────────────────────────────
    def _refresh_world(self) -> None:
        """Devices and screens the CMS has right now (cached 30 s in cms_client); runs in a worker thread."""
        try:
            screens = [str(s["screenName"]) for s in cms_client.list_screens() if s.get("screenName")]
        except Exception:
            screens = None
        lights = self._fetch_light_names() or None
        self._resolver.refresh(lights, screens)

    def _room_description(self) -> str:
        r = self._resolver
        reg = r._registry
        def also(name: str) -> str:
            """"cove light (also called tusker edge)": the room's name first, the technical one too."""
            spoken = say_names(name)
            return spoken if spoken == name else f"{spoken} (also called {name})"

        lights = [also(n) for n in r.offered_lights]
        extra = [n for n in r.light_names if n not in HIDDEN_FROM_LISTS and n not in r.offered_lights]
        sky = "; sky light front (tusker L1) and sky light back (tusker L2) are its two halves" if "tusker L3" in r.offered_lights else ""
        screens = []
        for name in r.screen_names:
            aliases = sorted({" ".join(t) for t, v in reg.enum_aliases.get("screenAlias", []) if v == name and " ".join(t) != name.lower()}, key=len)[:4]
            screens.append(f"{name} ({', '.join(aliases)})" if aliases else name)
        modes = list((reg.slots.get("ambientMode") or {}).get("values", {}))
        return "\n".join(
            [
                "Lights: " + "; ".join([*lights, *extra]) + sky,
                "AC: the air conditioner (one). Door: the front door lock. Sound: the TV's volume and mute.",
                "Screens: " + ("; ".join(screens) or "none known"),
                "Room modes: " + (", ".join(modes) or "none"),
            ]
        )

    def _plan_context(self) -> str:
        bits = []
        for kind, label in (("light", "lights"), ("screen", "screens"), ("ac", "the AC")):
            known = self._focus.get(kind)
            if known:
                bits.append(f"{label} just discussed or used = " + ("all lights" if known == [ALL] else ", ".join(say_names(n) for n in known)))
        return "; ".join(bits)

    # ── focus: what "them" / "that one" mean next ────────────────────────
    def _remember_inventory(self, args: dict) -> None:
        """After "list the lights": those lights, in the order they were read out, are what "them" and
        "the second one" mean. (Same list, same order, as actions/list_inventory.py speaks.)"""
        kind = str((args or {}).get("kind", "both")).strip().lower()
        try:
            if kind in ("light", "lights", "devices", "both"):
                order = [str(d["name"]) for d in cms_client.list_devices() if d.get("type") == "light" and d.get("name")]
                names = [n for n in order if n not in HIDDEN_FROM_LISTS]
                if {"tusker L1", "tusker L2"} <= set(order) and "tusker L3" not in names:
                    names.append("tusker L3")
                self._focus.remember("light", names)
            if kind in ("screens", "both"):
                self._focus.remember("screen", [str(s["screenName"]) for s in cms_client.list_screens() if s.get("screenName")])
        except Exception:
            pass

    def _remember_focus(self, tool: str, args: dict) -> None:
        """What "it" / "them" / "that one" can mean after a call went through, whichever path made it."""
        action, target = str(args.get("action", "")).lower(), str(args.get("target") or "")
        if tool == "device_control":
            if action in ("all_lights_on", "all_lights_off"):
                self._focus.remember("light", [ALL])
            elif action in ("lights_on", "lights_off", "lights_set") and target:
                self._focus.remember("light", [ALL] if self._resolver.says_all_lights(target) else [target])
            elif action == "ac_command" and str(args.get("command", "")).lower() in ("power_on", "power_off", "set_temp", "set_mode", "set_fan"):
                self._focus.remember("ac", ["ac"])
        elif tool == "screen_control" and args.get("screen"):
            self._focus.remember("screen", [str(args["screen"])])

    # ── the portfolio offer ──────────────────────────────────────────────
    _portfolio_skip_until = 0.0  # don't ask the CMS again before this (it was down, or has no such experience)

    async def _find_portfolio(self) -> tuple[str, str] | None:
        """(experience title, screen name) if White Tusker's portfolio can really be played on the main screen right now: the CMS
        has exactly one experience called portfolio (or the one named in `portfolio_experience`), the screen exists, and the portfolio is
        not already showing there. None otherwise, so Travis never offers what it cannot do or what is already happening."""
        cfg = load_api_config()
        now = time.monotonic()
        if not cfg.get("portfolio_offer", True) or now < self._portfolio_skip_until:
            return None
        wanted = str(cfg.get("portfolio_experience") or "").strip().lower()
        screen_want = str(cfg.get("portfolio_screen") or "tusker 86").strip().lower()

        def look() -> tuple[str, str] | None:
            try:
                experiences = [str(e.get("title", "")) for e in cms_client.list_experiences()]
                screens = cms_client.list_screens()
            except Exception:
                return None
            titles = [t for t in experiences if (same_name(t, wanted) if wanted else "portfolio" in name_key(t))]
            if len(titles) > 1:
                print(f"[Voice Agent] 🎞️ No portfolio offer: {len(titles)} experiences match ({titles}); set portfolio_experience.")
            screen = next((x for x in screens if same_name(str(x.get("screenName", "")), screen_want)), None)
            if len(titles) != 1 or screen is None:
                return None
            if not screen.get("blanked") and same_name(str(screen.get("experienceName") or ""), titles[0]):
                return None  # it is already playing there
            return titles[0], str(screen.get("screenName"))

        # A hard limit on the wait: with the CMS unreachable the two reads took 4.4 s (connect timeouts and retries). Past the limit the answer is "no offer",
        # the lookup thread finishes on its own, and the CMS is not asked again for 60 s.
        limit = float(cfg.get("portfolio_lookup_timeout_sec", 1.0))
        try:
            found = await asyncio.wait_for(asyncio.get_running_loop().run_in_executor(None, look), limit)
        except asyncio.TimeoutError:
            print(f"[Voice Agent] 🎞️ No portfolio offer: the CMS did not answer within {limit:g} s.")
            found = None
        if found is None:
            self._portfolio_skip_until = time.monotonic() + 60.0
        return found

    _portfolio_task: "asyncio.Task | None" = None

    def _prefetch_portfolio(self, topic: str) -> None:
        """Start the CMS lookup for the portfolio offer NOW, before the answer is spoken, so it runs while the answer is generated and played: by the time
        `_maybe_offer_portfolio` needs it, it has usually finished. Nothing is awaited here, and nothing is started unless an offer could follow."""
        cfg = load_api_config()
        after = int(cfg.get("portfolio_offer_after", 1) or 1)
        if (topic != "company" or not cfg.get("portfolio_offer", True) or self._portfolio_offered or self._portfolio_declined
                or self._company_answers + 1 < after or time.monotonic() < self._portfolio_skip_until):
            return
        if self._portfolio_task is None or self._portfolio_task.done():
            self._portfolio_task = asyncio.ensure_future(self._find_portfolio())

    async def _maybe_offer_portfolio(self, reply: str, topic: str) -> str:
        """From the first real answer about White Tusker in a conversation (config `portfolio_offer_after`, default 1), once, unless it was declined or
        the portfolio is already on the main screen: "Would you like me to play our portfolio on the main screen?" The yes/no is the pending-question
        step in commands.py."""
        after = int(load_api_config().get("portfolio_offer_after", 1) or 1)
        if topic != "company" or self._company_answers < after or self._portfolio_offered or self._portfolio_declined:
            return reply
        task, self._portfolio_task = self._portfolio_task, None
        portfolio = await (task if task is not None else self._find_portfolio())  # (started earlier by _prefetch_portfolio: usually done)
        if portfolio is None:
            return reply
        title, screen = portfolio
        self._confirm = title_match.Confirm(
            [title_match.Candidate("experience", title, 1.0, "screen_control", {"action": "assign_experience", "screen": screen, "content": title})],
            "portfolio", offer=True,
        )
        self._portfolio_offered = True
        where = "main screen" if same_name(screen, "tusker 86") else screen
        offer = f"Would you like me to play our portfolio on the {where}?"
        if not float(load_api_config().get("followup_window_sec", 8) or 0):
            offer += f" Say {self._wake_hint}, yes or no."
        print(f"[Voice Agent] 🎞️ Offering {title!r} on {screen!r}.")
        await self._say(offer)
        return f"{reply} {offer}".strip()

    # ── the planner path ─────────────────────────────────────────────────
    async def _run_plan(self, request: str, fallback) -> str:
        """Understand `request`, then carry it out. `fallback(request)` answers whatever isn't a room
        request (questions, chat, knowledge) or isn't understood: the model with its tools."""
        self._utterance = request
        if followup.is_more_request(request):
            # "tell me more" names no subject: the planner takes it for a cut-off sentence. It continues the last answer, or asks what about.
            print(f"[Voice Agent] 🧭 A request for more: {request!r}")
            if self._has_previous_answer():
                return await self._answer_from_knowledge(SimpleNamespace(topic=self._kb_last_topic), request, force_more=True)
            reply = with_wake_hint("What would you like to know more about?", self._wake_hint)
            self._path = "asked (more of what?)"
            await self._say(reply)
            return reply
        print(f"[Voice Agent] 🧭 Planning: {request!r}")
        plan = await self._planner.plan(request, self._room_description(), self._plan_context(), self._recent_history())  # LocalLLMError: handled by _run_command
        if plan is None:
            print("[Voice Agent] 🧭 No usable plan; the model answers instead.")
            return await fallback(request)
        self._timing["plan_done"] = time.monotonic()
        self._plan_log = plan.as_dict()
        print(f"[Voice Agent] 🧭 Plan: {self._plan_log}")
        if plan.kind == "suggest":
            # A statement ("it's too cold in here"): proposed and confirmed, never done on its own (agent/suggest_route.py). A question or a request the
            # model wrongly took for a statement, or a statement it did not quote, is treated as not understood and goes the way "other" goes.
            form = room_state.sentence_form(request)
            proposed = await self._suggest(plan, request, ask_only=form == "request") if form != "question" else None
            if proposed is not None:
                return proposed
            plan.kind = "other"
        names_a_device = plan.kind == "question" and any(n.lower() in request.lower() for n in self._device_words())  # "what brightness is <light A> at"
        if plan.kind == "other" or (plan.kind == "question" and (plan.topic in ("chat", "experience_center") or names_a_device)):
            # Not a command and not about the company, the CMS or Travis: maybe a question about the room right now, answered from the CMS.
            # (A command never gets here: the planner has already read it as actions. A "question" that names one of the room's devices is read
            # as one too: only the room-state classifier below, not the knowledge file, can say what a device is doing.)
            state_reply = await self._answer_room_state(request)
            if state_reply is not None:
                return state_reply
        if plan.kind == "question" and plan.topic != "chat":
            # About the company, the CMS, Travis or this place: looked up and answered from the knowledge base (agent/knowledge_answer.py),
            # never from the model's memory or from whatever was said earlier. Device commands never reach this.
            reply = await self._answer_from_knowledge(plan, request)
            if self._kb_ok:
                reply = await self._maybe_offer_portfolio(reply, self._kb_last_topic)  # the CMS is asked only now
            return reply
        if plan.kind in ("other", "question"):
            return await fallback(request)
        if plan.kind == "cancel":
            if self._intent.enabled and (await self._intent.check(request)).kind != "cancel":
                # Nothing in the sentence takes anything back ("turn it off" read as a cancel): not a cancel.
                print("[Voice Agent] 🧭 The model read a cancel the review doesn't see; the model with its tools answers.")
                return await fallback(request)
            reply = "Okay, I've left it as it is."
            await self._say(reply)
            return reply
        if plan.kind == "clarify":
            reply = with_wake_hint(plan.question or "Could you say that again?", self._wake_hint)
            await self._say(reply)
            return reply
        # What exists right now (cached 30 s in cms_client): only a real room request needs the CMS.
        await asyncio.get_running_loop().run_in_executor(None, self._refresh_world)
        compiled = self.compile_plan(plan, request)
        self._plan_log["resolved"] = compiled.notes
        for note in compiled.notes:
            print(f"[Voice Agent] 🎯 {note}")
        if self._leftover(plan, request) and (await self._intent.check(request)).kind == "cancel":
            # The words left over may be a take-back ("... not that"): the review reads the whole sentence once.
            reply = "Okay, I've left it as it is."
            await self._say(reply)
            return reply
        reply = await self._execute_compiled(compiled)
        if self._leftover(plan, request):
            reply = f"{reply} {self._partial_reply}".strip()  # the room part was done; the rest is not Travis's to answer
            await self._say(f" {self._partial_reply}")
        return reply

    async def _execute_compiled(self, compiled: Compiled) -> str:
        results: list[ToolResult] = []
        by_group: dict[int, list[ToolResult]] = {}
        for step in compiled.steps:
            rs = await self._run_guarded(step.tool, step.args, strict=False, trusted=True)
            by_group.setdefault(step.group, []).extend(rs)
            if step.focus and any(r.ok for r in rs):
                self._focus.remember(*step.focus)
        for rs in by_group.values():
            results += [self._merge_named_lights(rs)] if len(rs) > 1 and self._same_light_action(rs) else rs
        if not results and not compiled.questions:
            return await self._say_reply("I'm not sure what you'd like me to do. Could you say it again?")
        parts = []
        spoken = compose(results, self._wake_hint) if results else ""
        if spoken:
            parts.append(spoken)
        parts += compiled.questions
        self._plan_pending = compiled.pending if compiled.questions else None
        reply = with_wake_hint(" ".join(parts).strip(), self._wake_hint)
        if reply:
            await self._say(reply)
        return reply

    @staticmethod
    def _same_light_action(rs: list[ToolResult]) -> bool:
        first = rs[0].args
        return rs[0].name == "device_control" and str(first.get("action")) in ("lights_on", "lights_off", "lights_set") and all(
            {k: v for k, v in r.args.items() if k != "target"} == {k: v for k, v in first.items() if k != "target"} for r in rs
        )

    @staticmethod
    def _merge_named_lights(rs: list[ToolResult]) -> ToolResult:
        """"Set them to 50%" runs once per light; say "The cove light and the sky light are at 50%."
        Lights that failed are named on their own, since that is worth knowing."""
        args = dict(rs[0].args)
        ok = [r for r in rs if r.ok]
        failed = [r for r in rs if not r.ok]
        if not ok:
            return ToolResult(rs[0].name, args, False, rs[0].message)

        def named(rows: list[ToolResult]) -> str:
            names = [f"the {say_names(str(r.args.get('target')))}" for r in rows]
            return names[0] if len(names) == 1 else ", ".join(names[:-1]) + f" and {names[-1]}"

        action, level = str(args.get("action")), args.get("brightness")
        verb = {"lights_on": "on", "lights_off": "off"}.get(action) or (f"at {int(level)}%" if isinstance(level, (int, float)) else "set")
        be = "is" if len(ok) == 1 else "are"
        message = f"{named(ok).capitalize()} {be} {verb}."
        if failed:
            message += f" {named(failed).capitalize()} didn't respond."
        return ToolResult(rs[0].name, {**args, "target": [r.args.get("target") for r in rs]}, True, message)

    async def _say_reply(self, text: str) -> str:
        reply = with_wake_hint(text, self._wake_hint)
        await self._say(reply)
        return reply

    # ── compile: plan -> checked steps (no side effects) ─────────────────
    @staticmethod
    def _leftover(plan: Plan, request: str) -> bool:
        """Is `plan.leftover` really a part of the request that is not about the room? The model sometimes copies
        the whole sentence (or an action's own words) into it: that is not a part left out."""
        left = plan.leftover
        request = request.split(repairs.CORRECTION_NOTE_START)[0]  # our own note to the model is not something the user said
        if not left or not quote_supported(left, request):
            return False
        if any(len(a.quote.split()) > len(left.split()) and quote_supported(left, a.quote) for a in plan.actions):
            return False  # only a piece of an action's own words ("display"): not a part left out
        return len(left.split()) < 0.7 * len(request.split())

    def compile_plan(self, plan: Plan, utterance: str) -> Compiled:
        out = Compiled()
        self._cu = utterance  # what names and numbers are checked against
        for i, act in enumerate(plan.actions, 1):
            if self._leftover(plan, utterance) and quote_supported(act.quote, plan.leftover):
                # The model also called these words "not about the room": it is not an action ("tell me a joke" is not a screen_show).
                out.notes.append(f"{act.op} dropped: {act.quote!r} is the part left over, not a room request")
                continue
            self._group = i
            self._compile_action(act, utterance, out)
        out.steps = self._merged(out.steps)
        return out

    @staticmethod
    def _merged(steps: list[Step]) -> list[Step]:
        """"Dim it to 40 and make it warm white" is one change to one light, not two calls; the same
        call twice is one."""
        out: list[Step] = []
        for st in steps:
            twin = next((o for o in out if o.tool == st.tool and o.args.get("action") == st.args.get("action")
                         and o.args.get("target") == st.args.get("target") and o.args.get("screen") == st.args.get("screen")
                         and st.args.get("action") == "lights_set"), None)
            if twin is not None:
                twin.args.update(st.args)
            elif not any(o.tool == st.tool and o.args == st.args for o in out):
                out.append(st)
        return out

    def _name_said(self, target: Target, names: list[str], utterance: str) -> bool:
        """A name the model wrote must be something the user said (or an alias of what they said): it never
        picks a device or screen on its own ("show X" with no screen is not "show X on the main screen")."""
        return quote_supported(target.name, utterance) or all(self._guard._said(n, utterance) for n in names)

    def _compile_action(self, act: Action, utterance: str, out: Compiled) -> None:
        if not quote_supported(act.quote, utterance):
            # The model added something nobody asked for (an invented lock, an AC change...): not run, not asked about.
            out.notes.append(f"{act.op} dropped: its quote {act.quote!r} is not in the request")
            return
        tool, base = OPS[act.op]
        args = dict(base)
        p = act.parameters
        r = self._resolver
        nums = self._guard._numbers(utterance)

        def ask(question: str, missing: str | None = None) -> None:
            out.questions.append(question)
            if missing and out.pending is None:
                out.pending = PlanPending(act, missing, utterance)

        # --- values, checked against what was said ----------------------
        if act.op == "light_adjust":  # "make it dimmer": a change with no level; the answer is the level
            return ask("What brightness would you like, from 0 to 100 percent?", "brightness")
        if act.op == "ac_adjust":
            return ask(f"What temperature would you like, from {AC_MIN_TEMP} to {AC_MAX_TEMP} degrees?", "temperature")
        words = set(normalize(act.quote).split())  # what THIS action's own words say about units
        if act.op == "light_set" and words & {"degrees", "degree", "celsius"}:
            return ask("Brightness is a percentage from 0 to 100, not degrees. What level would you like?", "brightness")
        if act.op == "ac_set_temperature" and "percent" in words and not words & {"degrees", "degree", "celsius"}:
            return ask(f"The AC is set in degrees, from {AC_MIN_TEMP} to {AC_MAX_TEMP}. What temperature would you like?", "temperature")
        if act.op == "light_set":
            level = p.get("brightness")
            color = r.enum("color", str(p.get("color") or ""))
            if color is not None and not quote_supported(str(p.get("color")), utterance):
                color = None  # a colour nobody asked for
            if level is not None and (float(level) not in nums):
                level = None  # not something the user said: never used
            if level is not None and not 0 <= level <= 100:
                return ask("Brightness goes from 0 to 100 percent. What level would you like?", "brightness")
            if level is None and color is None:
                return ask("What brightness would you like, from 0 to 100 percent?", "brightness")
            if level is not None:
                args["brightness"] = int(level)
            if color is not None:
                args["color"] = color
        elif act.op == "ac_set_temperature":
            t = p.get("temperature")
            if t is None or float(t) not in nums:
                return ask(f"What temperature would you like, from {AC_MIN_TEMP} to {AC_MAX_TEMP} degrees?", "temperature")
            if not AC_MIN_TEMP <= t <= AC_MAX_TEMP:
                return ask(f"The AC goes from {AC_MIN_TEMP} to {AC_MAX_TEMP} degrees. What temperature would you like?", "temperature")
            args["params"] = {"temp": int(t)}
        elif act.op == "ac_set_mode":
            mode = r.enum("mode", str(p.get("mode") or ""))
            if mode not in AC_MODES:
                return ask(f"The AC modes are {', '.join(AC_MODES[:-1])} and {AC_MODES[-1]}. Which one would you like?")
            args["params"] = {"mode": mode}
        elif act.op == "ac_set_fan":
            fan = r.enum("fan", str(p.get("fan") or ""))
            if fan not in AC_FANS:
                return ask(f"The fan speeds are {', '.join(AC_FANS[:-1])} and {AC_FANS[-1]}. Which one would you like?")
            args["params"] = {"fan": fan}
        elif act.op in ("volume_up", "volume_down"):
            times = p.get("times")
            args["params"] = {"times": max(1, min(MAX_VOLUME_STEPS, int(times)))} if times else {"times": 3}
        elif act.op == "ambient_mode":
            mode = r.enum("ambientMode", str(p.get("mode") or act.target.name or ""))
            if mode is None:
                return ask("Which mode: pre-entry, entry, meeting or presentation?")
            args["target"] = mode
        elif act.op in ("ac_on", "ac_off", "mute"):
            pass

        if act.op in ("ac_on", "ac_off", "ac_set_temperature", "ac_set_mode", "ac_set_fan"):
            args["target"] = "ac"

        # --- targets, resolved against what exists ----------------------
        if _is_light_op(act.op):
            self._compile_lights(act, args, tool, out, ask)
        elif _is_screen_op(act.op):
            self._compile_screen(act, args, tool, out, ask)
        else:
            out.steps.append(Step(tool, args, act.op))

    def _compile_lights(self, act: Action, args: dict, tool: str, out: Compiled, ask) -> None:
        target = replace(act.target, type="light")
        if not target.name and not target.words:
            target = replace(target, words=act.quote)  # the model left the words out: its quote has them
        if target.scope == "reference" and not (quote_supported(target.words, self._cu) and points_back(target.words)):
            # "and brightness to 80" or "brightness of light" point back at nothing: pointing words (it, them, that one...) must really have been said.
            out.notes.append(f"{act.op}: reference without pointing words ({target.words!r}); asking")
            return ask(f"Which light would you like: {self._resolver._light_choices()}?", "light")
        res: Resolved = self._resolver.resolve(target, self._focus)
        out.notes.append(f"{act.op}: {target.describe()} -> {res.why or res.question}")
        if not res.ok:
            return ask(res.question, "light")
        if target.scope == "specific" and res.names and not self._name_said(target, res.names, self._cu):
            out.notes.append(f"{act.op}: the light {target.name!r} was not said; asking")
            return ask(self._resolver.resolve(replace(target, name="", scope="none"), Focus()).question, "light")
        if res.everything:
            out.steps.append(Step(tool, {**args, "target": "lights"}, act.op, ("light", [ALL]), self._group))
            self._focus.remember("light", [ALL])  # "...and make it green": it = what the sentence just named
            return
        for name in res.names:
            out.steps.append(Step(tool, {**args, "target": name}, act.op, ("light", res.names), self._group))
        self._focus.remember("light", res.names)

    def _compile_screen(self, act: Action, args: dict, tool: str, out: Compiled, ask) -> None:
        target = replace(act.target, type="screen")
        content = str(act.parameters.get("content") or "").strip()
        if target.scope == "reference" and not (quote_supported(target.words, self._cu) and points_back(target.words)):
            target = replace(target, scope="none")
        if act.op == "screen_show" and not content:
            return ask("What would you like me to show?")
        res = self._resolver.resolve(target, self._focus)
        out.notes.append(f"{act.op}: {target.describe()} -> {res.why or res.question}")
        if not res.ok:
            if act.op == "screen_show" and not target.name and not target.location:
                return ask(f"Which screen should I show {content} on?", "screen")
            return ask(res.question, "screen")
        if target.scope == "specific" and res.names and not self._name_said(target, res.names, self._cu):
            out.notes.append(f"{act.op}: the screen {target.name!r} was not said; asking")
            return ask(f"Which screen should I show {content} on?" if content else self._resolver.resolve(replace(target, name="", scope="none"), Focus()).question, "screen")
        if content:
            args["content"] = content
        for name in res.names:
            out.steps.append(Step(tool, {**args, "screen": name}, act.op, ("screen", res.names), self._group))
        self._focus.remember("screen", res.names)

    # ── an answer to a question the plan asked ───────────────────────────
    async def _plan_pending_step(self, command: str) -> str | None:
        """The reply if `command` answers the question a plan left open ("which screen?" -> "the kiosk",
        "what brightness?" -> "70"); None if it is something else, which then drops the question."""
        p, self._plan_pending = self._plan_pending, None
        if p is None or not p.fresh:
            return None
        words = [w for w in re.findall(r"[a-z0-9']+", command.lower())]
        if len(words) > 6 or match_command(command, self._registry, **self._match_opts) is not None:
            return None  # a whole new command is not an answer
        while words and words[0] in _LEAD_PARTICLES:
            words.pop(0)
        answer = " ".join(words)
        act = replace(p.action, parameters=dict(p.action.parameters), target=replace(p.action.target))
        act.op = {"light_adjust": "light_set", "ac_adjust": "ac_set_temperature"}.get(act.op, act.op)  # the level is known now
        r = self._resolver
        if p.missing == "screen":
            real = r.screen(answer)
            if real is None:
                return None
            act.target = Target(type="screen", scope="specific", name=real)
        elif p.missing == "light":
            real = r.light(answer)
            if real is None:
                return None
            act.target = Target(type="light", scope="specific", name=real)
        elif p.missing in ("brightness", "temperature"):
            nums = self._guard._numbers(command)
            if len(nums) != 1:
                return None
            act.parameters["brightness" if p.missing == "brightness" else "temperature"] = int(next(iter(nums)))
        else:
            return None
        self._path = "plan (answer to a question)"
        self._utterance = f"{p.request} {command}"
        compiled = Compiled()
        self._cu, self._group = self._utterance, 1
        self._compile_action(act, self._utterance, compiled)
        print(f"[Voice Agent] 🧭 Completed from the answer: {act.op} {act.target.describe()} {act.parameters}")
        return await self._execute_compiled(compiled)
