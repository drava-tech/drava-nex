"""Command routing for the local agent: pending answers, fast path, multi-action, model."""

from __future__ import annotations

import asyncio
import json
import re
import time
import traceback


# pyrefly: ignore [missing-import]

from nlu.command_matcher import match_command, normalize, resolve, similarity
from nlu.multi_action import is_fragment, resolve_multi, resolve_parts
from nlu import pending as pending_mod
from agent.repair_route import RepairOutcome
from nlu import capability
from nlu import repairs
from nlu import missing_target
from nlu import title_match
from nlu.spoken_names import say_names
from nlu.local_llm import LocalLLMError
from nlu.intent import Verdict
from nlu.transcript_fixes import fix_company_name
from safety.reply_guard import ToolResult, claims_action, compose, invents_number, unverified_reply, with_wake_hint
from actions import cms_client
from settings import load_api_config
from actions.device_control import run_device_control
from actions.screen_control import run_screen_control


_CONTENT_ACTIONS = ("assign_content", "assign_experience", "assign_media")
_ACTION_WORDS = frozenset("turn switch set play open close lock unlock increase decrease mute unmute start stop show".split())

# What the CMS says when a spoken name matches nothing (or several things).
_NOT_FOUND = re.compile(r"couldn['’]t find (?:exactly one |a )?(device|screen|mode) matching \"(.+?)\"", re.I)
# Which argument holds the name for each kind of thing.
_NAME_ARG = {"device": "target", "screen": "screen", "mode": "target"}


class _PendingHandled(Exception):
    """An answer to Travis's question was handled; skip the normal routing."""


class CommandMixin:
    """How a heard command is routed: pending answers, fast path, several actions, the model."""

    # The title Travis last asked "did you mean ...?" about (nlu/title_match.py).
    _confirm: "title_match.Confirm | None" = None
    # A question about an action ("can the CMS turn on the lights"): nothing may actuate while it is answered, whichever path ends up answering.
    _question_mode = False

    # ── Commands ─────────────────────────────────────────────────────────
    async def _run_command(self, command: str, unsure: bool = False, unfinished: bool = False):
        async with self._command_lock:
            self._calls_log, self._path, self._first_say = [], None, None
            self._plan_log = None
            self._off_topic = False
            self._question_mode = False
            command = repairs.strip_hesitations(command) or command
            command = fix_company_name(command, self._device_words())  # "whitest cove" -> "White Tusker" (whole phrase, never in a device command)
            self._exchange_active = True
            self._exchange_is_nudge = False
            self._reply_complete_at = None
            self._on_model_activity()
            print(f"[Voice Agent] 🗣️  You: {command}")
            self.ui.write_log(f"You: {command}")
            self.ui.set_state("THINKING")
            reply = ""
            on_topic = True
            done_reply, ask = "", command
            self._utterance = command
            repair, retracted = RepairOutcome(), False
            try:
                if unsure:
                    # Whisper doubts its own transcript (it makes up plausible commands from mumbles and
                    # noise): nothing is run, and what it heard is not kept as conversation.
                    self._path, on_topic = "declined (not sure what was said)", False
                    if unfinished:  # both doubts at once: say the more useful one
                        reply = f"It sounded like you stopped mid-sentence. Please say {self._wake_hint} and repeat the whole request."
                    else:
                        reply = f"I'm not sure I heard that right. Please say {self._wake_hint} and repeat the command."
                    await self._say(reply)
                    raise _PendingHandled
                # An answer to Travis's last question finishes that request first.
                answered = await self._pending_step(command)
                if answered is not None:
                    self._path, reply = "pending answer", answered
                    raise _PendingHandled
                # "Tell me about yourself, no?" / "turn on the lights, actually the fan": settled BEFORE anything is understood or run, so a withdrawn
                # request can never fire. A plain turn costs one regex here (agent/repair_route.py); only a cue turn can cost a small model call.
                repair = await self._repair_step(command)
                if repair.kind == "ask":
                    self._path, reply, on_topic = "asked (repair)", repair.reply, False
                    await self._say(reply)
                    raise _PendingHandled
                if repair.kind == "rewrite" and repair.command and repair.command != command:
                    print(f"[Voice Agent] 🩹 Understood as: {repair.command!r}")
                    command = ask = self._utterance = repair.command
                # "set the AC to 24, no wait, 22": the last version is what they mean. If
                # what follows isn't a whole command ("22"), only the model reads it.
                effective, skip_list, corrected = command, False, False
                retracted = repairs.ends_with_retraction(command) or repair.kind == "cancel"  # "...  No, no, no" / "scratch that": the whole request is taken back
                if repairs.has_marker(command) and not retracted:
                    after = repairs.last_version(command)
                    after_match = match_command(after, self._registry, **self._match_opts) if after else None
                    if after and ((after_match is not None and resolve(after_match).kind == "tool") or resolve_multi(after, self._registry, **self._match_opts)):
                        effective = after
                    else:
                        skip_list = True
                        fix = repairs.split_correction(command)
                        if fix:
                            corrected = True
                            # The model is told outright which version counts: left to itself it
                            # sometimes does the first thing they said.
                            ask = fix[0] + repairs.CORRECTION_NOTE.format(fix=fix[1])
                # "turn on tusker edge, stop": a closing "stop" cancels what came before it.
                if not skip_list and (repairs.ends_with_stop(effective) or retracted):
                    effective = "never mind"
                # "Can the CMS turn on the lights" / "how do I lock the door" ask about an action: answered and offered, never run.
                lead = None if (skip_list or unfinished) else capability.classify(effective)
                if lead is not None:
                    self._question_mode = True
                    cap_reply = await self._answer_capability(lead, effective)
                    if cap_reply is not None:
                        reply = cap_reply
                        raise _PendingHandled
                match = None if skip_list else match_command(effective, self._registry, **self._match_opts)
                if match is None and not skip_list and repairs.is_cancel(effective):
                    match = match_command("never mind", self._registry, **self._match_opts)  # "forget it, I'll do it later"
                if unfinished and match is None:
                    # The end-of-speech detector judged the sentence unfinished and the speaker stayed silent ("tell me about the"):
                    # Travis does not guess how it would have ended. (An exact known phrase above still runs.)
                    self._path, on_topic = "declined (unfinished sentence)", False
                    reply = f"It sounded like you stopped mid-sentence. Please say {self._wake_hint} and repeat the whole request."
                    await self._say(reply)
                    raise _PendingHandled
                # With the planner, the model reads whole sentences by meaning: the command list is only
                # the shortcut for an exact known phrase, and splitting at "and" / the change-of-mind
                # review are the planner's job (it is told to cancel or keep the last version).
                use_plan = self._planner is not None
                steps, leftover = ([], []) if (skip_list or match is not None or use_plan) else resolve_parts(effective, self._registry, **self._match_opts)
                # Whatever the list can't fully read is checked for a change of mind before
                # anything runs: a sentence can take its request back at any point and in
                # any words ("..., oh no", "..., actually don't", "..., wait wait").
                if match is None and not use_plan and (not steps or leftover):
                    verdict = await self._intent.check(command)
                    new_version = repairs.last_version(command) if corrected else None
                    if verdict.kind == "cancel" and new_version and not repairs.is_cancel(new_version):
                        verdict = Verdict("go", command)  # "..., actually make it 22": a new version, not a withdrawal
                    if verdict.kind == "cancel":
                        print(f"[Voice Agent] ✋ Taken back — nothing runs: {command!r}")
                        match = match_command("never mind", self._registry, **self._match_opts)
                        steps, leftover = [], []
                    elif verdict.kind == "keep" and not corrected:
                        # (A sentence with a correction in it already says which version counts:
                        # "..., or actually just the lamp" replaces the first part, it doesn't
                        # withdraw the rest, so only a full CANCEL is taken from the check there.)
                        print(f"[Voice Agent] ✋ Part taken back — keeping only: {verdict.command!r}")
                        effective, ask, skip_list, corrected = verdict.command, verdict.command, False, False
                        match = match_command(effective, self._registry, **self._match_opts)
                        steps, leftover = ([], []) if match is not None else resolve_parts(effective, self._registry, **self._match_opts)
                asked = None if (match is not None or steps or skip_list or use_plan) else self._seed_pending(effective)
                if match is None and not steps and not skip_list and missing_target.missing_screen(effective, self._screen_phrases()):
                    # A push with no screen: the whole command again, not a screen-only answer.
                    self._path = "asked (repeat: no screen)"
                    reply = missing_target.repeat_message(self._wake_hint)
                    await self._say(reply)
                elif asked is not None:
                    self._path = "brightness (asked or done)"
                    reply = await self._advance_pending(asked)
                elif match is not None:
                    self._path = "list"
                    reply = await self._run_fast_path(match)
                elif steps and leftover and any(is_fragment(c) for c in leftover):
                    self._path = "asked (half a request)"
                    bit = next(c for c in leftover if is_fragment(c))
                    reply = with_wake_hint(f'I\'m not sure what you meant by "{bit}". Which one do you want?', self._wake_hint)
                    await self._say(reply)
                elif steps and not leftover:
                    self._path = "list (several actions)"
                    reply = await self._run_multi(steps)
                elif (canned_reply := await self._try_canned(effective)) is not None:
                    reply = canned_reply  # a written-down FAQ or small-talk answer (agent/canned_route.py)
                    if self._path in ("faq",):
                        reply = await self._maybe_offer_portfolio(reply, self._kb_last_topic)
                elif use_plan:
                    # The model reads the meaning first; only what is not a room request reaches the gate + model.
                    self._path = "planner"
                    try:
                        reply = await self._run_plan(ask, lambda request, hint="": self._gated_model(request, command, corrected, hint))
                    except LocalLLMError:
                        reply = await self._without_model(effective)  # the model is down: only exact known commands can run
                    on_topic = not self._off_topic
                else:
                    if steps:
                        # The known parts run now, exactly; only the rest is left for the model.
                        self._path = "list + model"
                        done_reply = await self._run_multi(steps)
                        ask = " and ".join(leftover)
                        self._utterance = ask  # its calls must be backed by THIS part (not "lights" said in the other half)
                        print(f"[Voice Agent] ➡️  Left for the model: {ask!r}")
                    reply = await self._gated_model(ask, command, corrected)
                    on_topic = not self._off_topic
                if done_reply:
                    reply = f"{done_reply} {reply}".strip()
                    on_topic = True
            except _PendingHandled:
                pass
            except LocalLLMError as e:
                print(f"[Voice Agent] ⚠️ Local LLM: {e}")
                reply = "Sorry, my language model isn't available right now."
                await self._say(reply)
            except Exception as e:
                print(f"[Voice Agent] ⚠️ Command failed: {e}")
                traceback.print_exc()
                reply = "Sorry, something went wrong on my side."
                await self._say(reply)
            finally:
                # (before _finish_reply: the mic callback decides what comes next the moment the reply is complete)
                self._followup_wanted = self._expects_answer(reply)
                await self._finish_reply()
                if not self.ui.muted:
                    self.ui.set_state("LISTENING")
            if reply:
                print(f"[Voice Agent] 💬 TRAVIS: {reply}")
                self.ui.write_log(f"TRAVIS: {reply}")
            if self._xlog is not None:
                end = self._timing.get("vad_speech_end")
                first_text = (self._first_say - end) * 1000 if (end and self._first_say) else None
                record = {
                    "heard": self._last_heard, "command": command, "path": self._path or "list (reply only)",
                    "plan": self._plan_log, "calls": self._calls_log, "reply": reply,
                    "speech_end_to_first_word_ms": first_text,  # (the first name of the next one, kept for older readers)
                    "speech_end_to_first_text_ms": first_text,  # end of speech to the first words handed to the voice
                    **({"repair": self._repair_log} if self._repair_log else {}),
                }
                self._log_exchange(record, end, self._timing)
            # A declined request isn't remembered: it must not make a
            # follow-up ("another one") look like part of an on-topic chat.
            if on_topic:
                self._remember(command, reply)
                if not (repair.kind == "cancel" or retracted):  # (a take-back is not "the previous request")
                    self._remember_turn(command, reply)

    def _log_exchange(self, record: dict, speech_end: float | None, timing: dict) -> None:
        """Write the exchange line. The first AUDIO arrives after the reply has been handed over, so when there is a voice and a speech-end time the
        line is written once the audio has started (at most `_AUDIO_WAIT_SEC` later), with `speech_end_to_first_audio_ms`."""
        if not (speech_end and self.elevenlabs is not None and self._first_say):
            self._xlog.write({**record, "speech_end_to_first_audio_ms": None})
            return

        async def later() -> None:
            deadline = time.monotonic() + self._AUDIO_WAIT_SEC
            while "first_audio_chunk_received" not in timing and time.monotonic() < deadline:
                await asyncio.sleep(0.05)
            got = timing.get("first_audio_chunk_received")
            self._xlog.write({**record, "speech_end_to_first_audio_ms": (got - speech_end) * 1000 if got else None})

        task = asyncio.get_running_loop().create_task(later())
        self._xlog_tasks = [t for t in getattr(self, "_xlog_tasks", []) if not t.done()] + [task]

    _AUDIO_WAIT_SEC = 8.0

    async def _answer_capability(self, lead, request: str) -> str | None:
        """A question about an action. A written-down answer (FAQ) takes it first. Otherwise, if what is asked about is a real action, say so and
        offer it ("Yes, I can do that. Would you like me to turn on the lights?"): a "yes" runs exactly that command. None = it names no action
        (the normal route answers it, with actuation still switched off)."""
        canned = await self._try_canned(request)
        if canned is not None:
            if self._path == "faq":
                canned = await self._maybe_offer_portfolio(canned, self._kb_last_topic)
            return canned
        found = await self._calls_for(lead.inner)
        if not found:
            return None
        calls, trusted = found
        door = capability.touches_door(calls)
        hint = ""
        if not door and not float(load_api_config().get("followup_window_sec", 8) or 0):
            hint = f" Say {self._wake_hint}, yes or no."
        if not door:
            tool, args = calls[0]
            self._confirm = title_match.Confirm(
                [title_match.Candidate("command", lead.inner, 1.0, tool, args, also=list(calls[1:]), trusted=trusted)], lead.inner, offer=True)
        reply = capability.reply_text(lead, door, hint)
        self._path = "capability question (answered)" if door else "capability question (offered)"
        print(f"[Voice Agent] ❓ A question about an action, not a request: {lead.inner!r} ({'answered only' if door else 'offered'}).")
        await self._say(reply)
        return reply

    _ACTIONISH = frozenset("brighter dimmer louder quieter warmer cooler dim brighten raise lower increase decrease make change adjust play pause resume skip "
                           "mute unmute push assign display volume colour color".split())

    async def _calls_for(self, inner: str) -> tuple[list[tuple[str, dict]], bool] | None:
        """The calls `inner` would make, WITHOUT making them: ([(tool, args), ...], planner-resolved?) or None if it is not a room action."""
        match = match_command(inner, self._registry, **self._match_opts)
        if match is not None:
            res = resolve(match)
            return ([(res.tool, res.args), *res.also], False) if res.kind == "tool" and res.tool else None
        steps = resolve_multi(inner, self._registry, **self._match_opts)
        if steps:
            calls = [(st.resolution.tool or "", st.resolution.args) for st in steps if st.resolution.kind == "tool"]
            for st in steps:
                calls += list(st.resolution.also)
            return (calls, False) if calls else None
        if self._planner is None:
            return None
        words = set(re.findall(r"[a-z']+", inner.lower()))
        if not (words & (self._ACTIONISH | _ACTION_WORDS)) and not any(d.lower() in inner.lower() for d in self._device_words()):
            return None  # "how does it work": no model call for something that names no action
        try:
            plan = await self._planner.plan(inner, self._room_description(), self._plan_context(), self._recent_history())
        except LocalLLMError:
            return None
        if plan is None or plan.kind != "actions":
            return None
        await asyncio.get_running_loop().run_in_executor(None, self._refresh_world)
        compiled = self.compile_plan(plan, inner)
        if compiled.questions or not compiled.steps:
            return None
        return [(st.tool, st.args) for st in compiled.steps], True

    def _expects_answer(self, reply: str) -> bool:
        """Travis just asked something and waits for the answer: a pending question or offer, or a reply that is itself a question. Then the
        mic stays open for `followup_window_sec` after the question has been spoken (agent/mic_listener.py)."""
        if not float(load_api_config().get("followup_window_sec", 8) or 0):
            return False
        confirm = self._confirm
        if confirm is not None and confirm.fresh:
            return True
        if self._pending is not None or self._plan_pending is not None or self._repair_waiting():
            return True
        return "?" in (reply or "")

    def _device_words(self) -> list[str]:
        """Every spoken name of a light, screen or device in the command list."""
        words: list[str] = []
        for slot in ("light", "screenAlias", "screen", "device"):
            words += list((self._registry.slots.get(slot) or {}).get("values", {}).keys())
        return words

    async def _without_model(self, request: str) -> str:
        """The language model can't be reached: whatever the command list reads exactly still runs
        (several known commands in one sentence included); the rest is said to be unavailable."""
        steps, leftover = resolve_parts(request, self._registry, **self._match_opts)
        reply = await self._run_multi(steps) if steps else ""
        if leftover or not steps:
            note = "Sorry, my language model isn't available right now."
            await self._say(note)
            reply = f"{reply} {note}".strip()
        return reply

    async def _gated_model(self, ask: str, command: str, corrected: bool, hint: str = "") -> str:
        """What the command list and the planner did not take as a room request: the relevance gate
        (off-topic is declined, a mixed request is trimmed), then the model answers with its tools.
        A non-empty `hint` means the planner already classed it as a question about the company, the CMS,
        Travis or this place: that is in scope by definition, so the gate (which does not know "White
        Tusker" is the company) must not decline it; it goes straight to the knowledge base."""
        if hint:
            self._path = "model"
            return await self._run_llm(ask + hint)
        review = await self._gate.review(ask, self._recent_history(), corrected=corrected)
        self._timing["gate_done"] = time.monotonic()
        if not review.allowed:
            self._path = "declined (off topic)"
            self._off_topic = True
            print(f"[Voice Agent] 🚧 Off topic — declining: {command!r}")
            # One or two words ("I won") is a mishearing, not an off-topic request.
            reply = "Sorry, I didn't catch that." if len(command.split()) <= 2 else self._decline_text()
            await self._say(reply)
            return reply
        if review.dropped:
            print(f"[Voice Agent] 🚧 Part off topic — keeping only: {review.command!r}")
        if not review.dropped:
            answered = await self._probe_knowledge(review.command)  # in scope but not a room request: the knowledge answers if it can
            if answered is not None:
                return answered
        self._path = "model"
        reply = await self._run_llm(review.command + hint)
        if review.dropped:
            reply = f"{reply} {self._partial_reply}".strip()
            await self._say(f" {self._partial_reply}")
        return reply

    def _screen_phrases(self) -> set[str]:
        """Every way the room names a screen: the aliases in commands.json."""
        return set(self._guard.screen_names) | {alias for alias, _ in self._guard._aliases}

    # ── Half-finished brightness requests (nlu/pending.py) ──────────────
    def _seed_pending(self, command: str):
        """"Make it dimmer" with no light or level: asked for here, with no model, so no
        light and no number can be made up."""
        return pending_mod.seed(command, self._guard.light_names, self._guard._aliases)

    async def _pending_step(self, command: str) -> str | None:
        """The reply if `command` answers the question Travis last asked (or is a bare
        yes/no with nothing to say yes to); None if it is a new request."""
        confirmed = await self._confirm_step(command)
        if confirmed is not None:
            return confirmed
        if self._plan_pending is not None:
            answered = await self._plan_pending_step(command)
            if answered is not None:
                return answered
        p, self._pending = self._pending, None
        if p is None or not p.fresh:
            if pending_mod.is_yes_no(command):
                reply = with_wake_hint("I'm not waiting on an answer from you. What would you like me to do?", self._wake_hint)
                await self._say(reply)
                return reply
            return None
        if repairs.is_cancel(command) or pending_mod.is_no(command):
            reply = "Okay, I've left it as it is."
            await self._say(reply)
            return reply
        if pending_mod.is_yes_no(command):
            self._pending = p
            return await self._advance_pending(p)
        # A whole new command is not an answer ("turn off tusker edge" names a light too).
        # (A bare light name matches the list's "On or off?" reply: that is an answer here.)
        whole = match_command(command, self._registry, **self._match_opts)
        if (whole is not None and whole.intent != "LIGHT_NO_ACTION") or (
            whole is None and resolve_parts(command, self._registry, **self._match_opts)[0]
        ):
            return None
        if pending_mod.about_something_else(command):
            return None  # a new request about the AC, volume, the door...: the brightness question lapses
        if not pending_mod.fill(p, command, self._guard.light_names, self._guard._aliases):
            return None
        return await self._advance_pending(p)

    async def _confirm_step(self, command: str) -> str | None:
        """"Did you mean <title>?" answered: yes pushes exactly that title, no offers the next
        closest, "never mind" drops it. Anything else is a new request and the question lapses."""
        c, self._confirm = self._confirm, None
        if c is None or not c.fresh or c.current is None:
            return None
        answer = None
        if c.offer:  # Travis's own offer: visitors answer in their own words ("go ahead", "not now")
            answer = "no" if repairs.is_cancel(command) else title_match.offer_answer(command)
            if answer is None:
                return None  # a new request; the offer lapses
        if answer == "no":
            self._path = "offer declined"
            if c.current is not None and c.current.kind != "command":
                self._portfolio_declined = True  # not asked again in this conversation
            reply = "Okay, no problem."
        elif repairs.is_cancel(command):
            reply = "Okay, I've left it as it is."
        elif pending_mod.is_no(command):
            if c.next() is None:
                reply = f"Okay, I won't push anything. Please say {self._wake_hint} and repeat the command."
            else:
                self._confirm = c
                reply = title_match.question(c, self._wake_hint, first=False)
        elif answer == "yes" or pending_mod.is_yes_no(command):
            cand = c.current
            self._path = "offer accepted" if c.offer else "name confirmed"
            print(f"[Voice Agent] ✅ Confirmed: {cand.title!r} ({cand.kind}) -> {cand.tool} {cand.args}")
            if cand.kind == "command":
                # The command Travis offered after a question: the exact calls, through the normal action path and its guards.
                self._utterance = cand.title
                results = await self._run_guarded(cand.tool, dict(cand.args), strict=False, trusted=cand.trusted)
                for tool, args in cand.also:
                    results += await self._run_guarded(tool, dict(args), strict=False, trusted=cand.trusted)
                reply = compose(results, self._wake_hint) or ""
                if reply:
                    await self._say(reply)
                return reply
            if cand.tool == "screen_control" and cand.args.get("action") in _CONTENT_ACTIONS:
                ok, msg = await self._assign_content(dict(cand.args))
            else:
                ok, msg = await self._call_tool(cand.tool, dict(cand.args))
            self._calls_log.append({"name": cand.tool, "args": cand.args, "ok": ok, "message": msg})
            self._guard.remember(cand.tool, cand.args, ok)
            reply = compose([ToolResult(cand.tool, cand.args, ok, msg)], self._wake_hint) or ""
        else:
            return None
        if reply:
            await self._say(reply)
        return reply

    async def _advance_pending(self, p) -> str:
        """Ask for what is still missing, or send the brightness once light and level were both said."""
        q = pending_mod.question(p, [say_names(n) for n in self._guard.offered_light_names])
        if q:
            self._pending = p
            reply = with_wake_hint(q, self._wake_hint)
            await self._say(reply)
            return reply
        which = "the lights" if p.name == pending_mod.ALL else p.name
        self._utterance = f"set {which} brightness to {p.level} percent"
        results = await self._run_guarded(
            "device_control", {"action": "lights_set", "target": p.name, "brightness": p.level}, strict=False
        )
        text = compose(results, self._wake_hint) or ""
        if text:
            await self._say(text)
        return text

    async def _run_fast_path(self, match) -> str:
        res = resolve(match)
        print(
            f"[Voice Agent] ⚡ Fast path: {match.intent} ({match.method} "
            f"{match.confidence:.2f}) {res.tool or 'reply'} {res.args or ''}"
        )
        if res.kind == "reply":
            await self._say(res.text or "")
            return res.text or ""
        results = await self._run_calls(res)
        if res.tool == "shutdown_travis":  # it says its own goodbye
            return ""
        if len(results) == 1 and results[0].ok and res.text:
            text = res.text
        else:
            text = compose(results, self._wake_hint) or ""
        if text:
            await self._say(text)
        return text

    async def _run_multi(self, steps) -> str:
        """Several known commands in one sentence, run in the order spoken. One failing
        or refused part never stops the others; every part is reported truthfully."""
        print(f"[Voice Agent] ⚡ {len(steps)} actions: " + " | ".join(s.clause for s in steps))
        results: list[ToolResult] = []
        for st in steps:
            results += await self._run_calls(st.resolution)
        text = compose(results, self._wake_hint) or ""
        if text:
            await self._say(text)
        return text

    async def _run_calls(self, res) -> list[ToolResult]:
        """A matched command's call, and any further calls it makes ("heat mode at 21 degrees")."""
        results = await self._run_guarded(res.tool or "", res.args, strict=False)
        for tool, args in res.also:
            results += await self._run_guarded(tool, args, strict=False)
        return results

    def _fetch_light_names(self) -> list[str]:
        try:
            return [str(d["name"]) for d in cms_client.list_devices() if d.get("type") == "light" and d.get("name")]
        except Exception:
            return []

    async def _run_guarded(self, name: str, args: dict, strict: bool, trusted: bool = False) -> list[ToolResult]:
        """Run a tool call only if it is backed by what was said (safety/action_guard.py).
        Otherwise nothing is sent and the result is a question for the user. `trusted`: the target
        was already resolved by the planner path (agent/planning.py); only the values are checked."""
        prep = await asyncio.get_running_loop().run_in_executor(
            None, lambda: self._guard.prepare(name, args, self._utterance, self._light_names_fn, strict, trusted)
        )
        if prep.question:
            self._calls_log.append({"name": name, "args": args, "ok": False, "rejected": True, "message": prep.question, "why": prep.note})
            print(f"[Voice Agent] 🛑 Not sent ({prep.note}): {name} {args}")
            return [ToolResult(name, args, False, prep.question, {"rejected": True, "note": prep.note})]
        out: list[ToolResult] = []
        for n, a in prep.calls:
            if n == "screen_control" and a.get("action") in _CONTENT_ACTIONS:
                ok, msg = await self._assign_content(a)
            else:
                ok, msg = await self._call_tool(n, a)
            if not ok:
                msg = await self._offer_close_names(n, a, msg) or msg
            out.append(ToolResult(n, a, ok, msg))
            self._calls_log.append({"name": n, "args": a, "ok": ok, "message": msg})
            self._guard.remember(n, a, ok)
            if ok and self._planner is not None:
                self._remember_focus(n, a)  # "it" / "them" mean what any path (list, planner, model) just acted on
        if prep.scope and any(r.ok for r in out):
            self._guard.remember_scope("light", prep.scope)
        if prep.scope == "all lights" and len(out) > 1:
            out = [self._merge_all_lights(out)]  # one sentence for "the lights", not every light's name
        return out

    @staticmethod
    def _merge_all_lights(results: list[ToolResult]) -> ToolResult:
        """"Set the lights to 50%" runs once per light; say "All lights are at 50%." instead of reading
        every light's name. Names are spoken only for lights that failed (that is worth knowing)."""
        args = dict(results[0].args)
        args["target"] = "all lights"
        failed = [r for r in results if not r.ok]
        if len(failed) == len(results):
            return ToolResult(results[0].name, args, False, results[0].message)  # e.g. "Could not reach the CMS."
        level, color = args.get("brightness"), str(args.get("color") or "").strip()
        look = []
        if color and not color.startswith("#"):
            look.append(color)
        if isinstance(level, (int, float)):
            look.append(f"at {int(level)}%")
        what = " ".join(look) if look else "set"
        message = f"All lights are {what}."
        if failed:
            names = ", ".join(str(r.args.get("target")) for r in failed)
            message = f"All lights are {what} except {names}, which didn't respond."
        return ToolResult(results[0].name, args, True, message)

    async def _name_pool(self, kind: str) -> list[str]:
        """The real names of one kind of thing: from the CMS where it lists them, plus the spoken
        names in commands.json. Empty if neither is available."""

        def fetch() -> list[str]:
            names: list[str] = []
            try:
                if kind == "device":
                    names += [str(d["name"]) for d in cms_client.list_devices() if d.get("name")]
                elif kind == "screen":
                    names += [str(x["screenName"]) for x in cms_client.list_screens() if x.get("screenName")]
            except Exception:
                pass
            return names

        names = await asyncio.get_running_loop().run_in_executor(None, fetch)
        if kind == "device":
            names += self._guard.light_names
        elif kind == "screen":
            names = self._guard.screen_names + names
        elif kind == "mode":
            names += list((self._registry.slots.get("ambientMode") or {}).get("values", {}))
        seen: set[str] = set()
        out: list[str] = []
        for n in names:
            key = normalize(n)
            if "soundbar" not in n.lower() and key not in seen:
                seen.add(key)
                out.append(n)
        return out

    async def _offer_close_names(self, tool: str, args: dict, message: str) -> str | None:
        """The CMS found no device/screen/mode for a name that was SAID: if a real one sounds like it,
        ask "did you mean ...?" (nlu/title_match.py). The question is the reply; nothing is sent
        until the user says yes. Works for every path that makes calls: the list, several actions, the model."""
        found = _NOT_FOUND.search(message or "")
        if found is None or self._confirm is not None:
            return None
        kind, said = found.group(1).lower(), found.group(2)
        field = _NAME_ARG[kind]
        if normalize(str(args.get(field) or "")) != normalize(said):
            return None
        near = title_match.suggest(said, await self._name_pool(kind))
        if not near:
            return None
        candidates = [title_match.Candidate(kind, t, sc, tool, {**args, field: t}) for t, sc in near]
        self._confirm = title_match.Confirm(candidates, said)
        print(f"[Voice Agent] ❓ No {kind} {said!r}; asking about {[(c.title, c.score) for c in candidates]}")
        return title_match.question(self._confirm, self._wake_hint)

    async def _content_titles(self) -> tuple[list[str], list[str]]:
        """(experience titles, media names) as the CMS has them; empty if it can't be reached."""

        def lists() -> tuple[list[str], list[str]]:
            try:
                return ([str(e.get("title", "")) for e in cms_client.list_experiences()], [str(m.get("name", "")) for m in cms_client.list_media()])
            except Exception:
                return [], []

        return await asyncio.get_running_loop().run_in_executor(None, lists)

    async def _assign_content(self, args: dict) -> tuple[bool, str]:
        """Push an experience or media item to a screen. "Show X on <screen>" doesn't say which
        kind X is: it is pushed as whichever list it is in (the CMS refuses the wrong kind).
        If the CMS has no such title, the closest sounding real titles are offered one by one
        (see nlu/title_match.py) instead of failing."""
        content = str(args.get("content") or "")
        kinds = {"assign_experience": ["experience"], "assign_media": ["media"]}.get(str(args.get("action")))
        titles: dict[str, list[str]] | None = None
        if kinds is None:
            experiences, media = await self._content_titles()
            titles = {"experience": experiences, "media": media}
            want = normalize(content)

            def best(names: list[str]) -> float:
                scores = [1.0 if (want in normalize(n) or normalize(n) in want) and want else similarity(want, normalize(n)) for n in names]
                return max(scores, default=0.0)

            kinds = ["experience", "media"] if best(experiences) >= best(media) else ["media", "experience"]
        message = ""
        for kind in kinds:
            action = "assign_experience" if kind == "experience" else "assign_media"
            ok, message = await self._call_tool("screen_control", {**args, "action": action})
            if ok:
                return True, message
            wrong_kind = "matching" in message and ("experience" in message or "media item" in message)
            if not wrong_kind:
                return False, message  # a screen problem, or similar: the other kind won't help
        if titles is None:
            experiences, media = await self._content_titles()
            titles = {"experience": experiences, "media": media}
        candidates = sorted(
            (
                title_match.Candidate(
                    "experience" if k == "experience" else "media item", t, sc, "screen_control",
                    {**args, "action": "assign_experience" if k == "experience" else "assign_media", "content": t},
                )
                for k in kinds
                for t, sc in title_match.suggest(content, titles[k])
            ),
            key=lambda c: -c.score,
        )[: title_match.MAX_ASKED]
        screen = str(args.get("screen") or "")
        if candidates and screen:
            self._confirm = title_match.Confirm(candidates, content)
            print(f"[Voice Agent] ❓ No title {content!r}; asking about {[(c.title, c.score) for c in candidates]}")
            return False, title_match.question(self._confirm, self._wake_hint)
        if titles["experience"] or titles["media"]:
            # Nothing sounds like it: say what there is (real names only). Experiences are the
            # short list people mean by "show X"; the media library (100+ items) is only read out
            # when media was asked for by name ("play media X").
            parts = [f"I couldn't find \"{content}\"."]
            if "experience" in kinds:
                parts.append(f"The experiences are: {', '.join(titles['experience'][:6]) or 'none'}.")
            else:
                parts.append(f"The media items are: {', '.join(titles['media'][:6]) or 'none'}.")
            return False, " ".join(parts)
        return False, message

    @property
    def _wake_hint(self) -> str:
        """How to address Travis, as spoken in "Say Hey Travis, then ..."."""
        return (self._wake_model.label if self._wake_model else "hey travis").title()

    @staticmethod
    def _dedupe_calls(calls):
        """The same tool with the same arguments twice in one round is one action."""
        seen, out = set(), []
        for c in calls:
            key = (c.name, json.dumps(c.args, sort_keys=True, default=str))
            if key not in seen:
                seen.add(key)
                out.append(c)
        return out

    async def _speak_checked(self, text: str, results: list[ToolResult], rejected: list[ToolResult] | None = None) -> str:
        """Say the model's own words only if they don't claim something that didn't happen
        (safety/reply_guard.py): what was actually done is said instead."""
        actions = [r for r in results if r.is_action and r.ok]
        done_text = compose(actions, self._wake_hint) if actions else ""
        # With no tool behind it, a level or temperature the user never said is invented.
        invented = bool(text) and not results and invents_number(text, self._guard._numbers(self._utterance))
        if text and (claims_action(text) or invented):
            if actions:
                text = done_text or ""
            else:
                print(f"[Voice Agent] 🛑 Blocked an unbacked claim: {text!r}")
                text = unverified_reply(self._wake_hint)
        elif text and done_text:
            text = f"{done_text} {text}"  # what was done, then the question or answer
        elif not text and rejected:
            text = compose(list(results) + list(rejected), self._wake_hint) or ""
        elif not text and not results:
            text = "Sorry, I didn't catch that."
        text = with_wake_hint(text, self._wake_hint)
        if text:
            await self._say(text)
        return text

    async def _run_llm(self, command: str) -> str:
        from datetime import datetime

        now = datetime.now().strftime("%A %I:%M %p")
        context = self._guard.context_line()
        # The time and what was last used ride on this request only, after the cached
        # prefix (system prompt + tools), so Ollama doesn't re-read the whole prompt.
        messages = [
            {"role": "system", "content": self._system_prompt},
            *self._recent_history(),
            {"role": "user", "content": f"(It is {now}. {context}) {command}".replace(". )", ".)")},
        ]
        results: list[ToolResult] = []  # everything that actually reached the CMS
        rejected: list[ToolResult] = []  # calls the guard held back in the latest round
        done: set[tuple[str, str]] = set()
        retries_left = 1
        print(f"[Voice Agent] 🧠 {self._llm.model} ...")
        for _ in range(self._MAX_TOOL_ROUNDS):
            chunks: list[str] = []
            calls = []
            # Nothing is spoken while the model is still generating: text it writes
            # before (or instead of) calling a tool can't be trusted until we know
            # what really ran. Whole-text speaking also keeps digits spaced ("to 22").
            async for kind, value in self._llm.stream(messages, self._llm_tools):
                if kind == "text":
                    self._timing.setdefault("llm_first_token", time.monotonic())
                    chunks.append(value)
                else:
                    calls = value
            text = "".join(chunks).strip()
            if not calls:
                return await self._speak_checked(text, results, rejected)
            calls = self._dedupe_calls(calls)
            messages.append(
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{"function": {"name": c.name, "arguments": c.args}} for c in calls],
                }
            )
            round_results: list[ToolResult] = []
            rejected = []
            for call in calls:
                key = (call.name, json.dumps(call.args, sort_keys=True, default=str))
                if key in done:  # already done in an earlier round
                    messages.append({"role": "tool", "tool_name": call.name, "content": "Already done."})
                    continue
                print(f"[Voice Agent] 📞 {call.name}")
                rs = await self._run_guarded(call.name, call.args, strict=True)
                done_ok = [r for r in rs if not r.extra.get("rejected")]
                rejected += [r for r in rs if r.extra.get("rejected")]
                round_results += done_ok
                if done_ok:
                    done.add(key)
                results += done_ok
                note = " ".join(
                    (f"NOT SENT: {r.extra.get('note')}. Use only what the user said; if it is unclear, ask one short question without calling a tool."
                     if r.extra.get("rejected") else r.message)
                    for r in rs
                )
                messages.append({"role": "tool", "tool_name": call.name, "content": note})
                if call.name == "shutdown_travis":
                    return ""
            if rejected and retries_left > 0:
                retries_left -= 1  # the model gets one chance to correct itself, or to ask
                continue
            # Results that are already a sentence (device/screen actions, status reads, the
            # inventory) are spoken as they are: true by construction, and no second LLM
            # round to wait for. Only results that need interpreting go back to the model.
            spoken = compose(results + rejected, self._wake_hint)
            if spoken is not None:
                if spoken:
                    await self._say(spoken)
                return spoken
            rejected = []  # a model-written answer follows; held-back calls were already explained to it
        return await self._speak_checked("", results, rejected)

    async def _call_tool(self, name: str, args: dict) -> tuple[bool, str]:
        """Run a tool; (whether it succeeded, what it reported). Device and
        screen commands report real success (the fast path's own short
        confirmation is only spoken then); anything else goes through
        TravisBase._run_tool."""
        runner = {
            "device_control": run_device_control,
            "screen_control": run_screen_control,
        }.get(name)
        if runner is not None and self._question_mode and str(args.get("action", "")).lower() != "status":
            print(f"[Voice Agent] 🛑 Not sent (it was a question, not a request): {name} {args}")
            return False, "That sounded like a question, so I haven't changed anything."
        if runner is None:
            if name == "list_inventory" and self._planner is not None:
                self._remember_inventory(args)  # what "them" / "the second one" mean next
            return True, await self._run_tool(name, args)

        print(f"[Voice Agent] 🔧 {name}  {args}")
        started = time.monotonic()
        self._timing.setdefault("cms_request_started", started)
        self._tool_active += 1
        try:
            ok, message = await asyncio.get_running_loop().run_in_executor(
                None, runner, dict(args)
            )
        except Exception as e:
            traceback.print_exc()
            ok, message = False, f"{name} failed: {e}"
        finally:
            self._tool_active -= 1
        self._timing["cms_response_received"] = time.monotonic()
        print(f"[Voice Agent] ⏱️  {name} took {(time.monotonic() - started) * 1000:.0f}ms")
        print(f"[Voice Agent] 📤 {name} → {message[:80]}")
        return ok, message

    # ── Short conversation memory, for "turn it off" follow-ups ──────────
    def _recent_history(self) -> list[dict]:
        if time.monotonic() - self._history_at > self._HISTORY_TTL_SEC:
            self._history = []
        return list(self._history)

    def _remember(self, command: str, reply: str):
        self._recent_history()  # expire first
        self._history.append({"role": "user", "content": command})
        if reply:
            self._history.append({"role": "assistant", "content": reply})
        self._history = self._history[-self._HISTORY_MESSAGES :]
        self._history_at = time.monotonic()
