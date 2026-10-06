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
from nlu import repairs
from nlu import title_match
from nlu.local_llm import LocalLLMError
from nlu.intent import Verdict
from safety.reply_guard import ToolResult, claims_action, compose, invents_number, unverified_reply, with_wake_hint
from actions import cms_client
from actions.device_control import run_device_control
from actions.screen_control import run_screen_control


_CONTENT_ACTIONS = ("assign_content", "assign_experience", "assign_media")

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

    # ── Commands ─────────────────────────────────────────────────────────
    async def _run_command(self, command: str):
        async with self._command_lock:
            self._calls_log, self._path, self._first_say = [], None, None
            command = repairs.strip_hesitations(command) or command
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
            try:
                # An answer to Travis's last question finishes that request first.
                answered = await self._pending_step(command)
                if answered is not None:
                    self._path, reply = "pending answer", answered
                    raise _PendingHandled
                # "set the AC to 24, no wait, 22": the last version is what they mean. If
                # what follows isn't a whole command ("22"), only the model reads it.
                effective, skip_list, corrected = command, False, False
                if repairs.has_marker(command):
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
                            ask = f"{fix[0]} (they corrected themselves: {fix[1]}. Do only the corrected request.)"
                # "turn on tusker edge, stop": a closing "stop" cancels what came before it.
                if not skip_list and repairs.ends_with_stop(effective):
                    effective = "never mind"
                match = None if skip_list else match_command(effective, self._registry, **self._match_opts)
                if match is None and not skip_list and repairs.is_cancel(effective):
                    match = match_command("never mind", self._registry, **self._match_opts)  # "forget it, I'll do it later"
                steps, leftover = ([], []) if (skip_list or match is not None) else resolve_parts(effective, self._registry, **self._match_opts)
                # Whatever the list can't fully read is checked for a change of mind before
                # anything runs: a sentence can take its request back at any point and in
                # any words ("..., oh no", "..., actually don't", "..., wait wait").
                if match is None and (not steps or leftover):
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
                asked = None if (match is not None or steps or skip_list) else self._seed_pending(effective)
                if asked is not None:
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
                else:
                    if steps:
                        # The known parts run now, exactly; only the rest is left for the model.
                        self._path = "list + model"
                        done_reply = await self._run_multi(steps)
                        ask = " and ".join(leftover)
                        self._utterance = ask  # its calls must be backed by THIS part (not "lights" said in the other half)
                        print(f"[Voice Agent] ➡️  Left for the model: {ask!r}")
                    review = await self._gate.review(ask, self._recent_history(), corrected=corrected)
                    self._timing["gate_done"] = time.monotonic()
                    if not review.allowed:
                        self._path = "declined (off topic)"
                        on_topic = False
                        print(f"[Voice Agent] 🚧 Off topic — declining: {command!r}")
                        # One or two words ("I won") is a mishearing, not an off-topic request.
                        reply = "Sorry, I didn't catch that." if len(command.split()) <= 2 else self._off_topic_reply
                        await self._say(reply)
                    else:
                        if review.dropped:
                            print(f"[Voice Agent] 🚧 Part off topic — keeping only: {review.command!r}")
                        self._path = "model"
                        reply = await self._run_llm(review.command)
                        if review.dropped:
                            reply = f"{reply} {self._partial_reply}".strip()
                            await self._say(f" {self._partial_reply}")
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
                await self._finish_reply()
                if not self.ui.muted:
                    self.ui.set_state("LISTENING")
            if reply:
                print(f"[Voice Agent] 💬 TRAVIS: {reply}")
                self.ui.write_log(f"TRAVIS: {reply}")
            if self._xlog is not None:
                end = self._timing.get("vad_speech_end")
                self._xlog.write({
                    "heard": self._last_heard, "command": command, "path": self._path or "list (reply only)",
                    "calls": self._calls_log, "reply": reply,
                    "speech_end_to_first_word_ms": (self._first_say - end) * 1000 if (end and self._first_say) else None,
                })
            # A declined request isn't remembered: it must not make a
            # follow-up ("another one") look like part of an on-topic chat.
            if on_topic:
                self._remember(command, reply)

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
        if not pending_mod.fill(p, command, self._guard.light_names, self._guard._aliases):
            return None
        return await self._advance_pending(p)

    async def _confirm_step(self, command: str) -> str | None:
        """"Did you mean <title>?" answered: yes pushes exactly that title, no offers the next
        closest, "never mind" drops it. Anything else is a new request and the question lapses."""
        c, self._confirm = self._confirm, None
        if c is None or not c.fresh or c.current is None:
            return None
        if repairs.is_cancel(command):
            reply = "Okay, I've left it as it is."
        elif pending_mod.is_no(command):
            if c.next() is None:
                reply = f"Okay, I won't push anything. Please say {self._wake_hint} and repeat the command."
            else:
                self._confirm = c
                reply = title_match.question(c, self._wake_hint, first=False)
        elif pending_mod.is_yes_no(command):
            cand = c.current
            self._path = "name confirmed"
            print(f"[Voice Agent] ✅ Confirmed: {cand.title!r} ({cand.kind}) -> {cand.tool} {cand.args}")
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
        q = pending_mod.question(p, self._guard.light_names)
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

    async def _run_guarded(self, name: str, args: dict, strict: bool) -> list[ToolResult]:
        """Run a tool call only if it is backed by what was said (safety/action_guard.py).
        Otherwise nothing is sent and the result is a question for the user."""
        prep = await asyncio.get_running_loop().run_in_executor(
            None, lambda: self._guard.prepare(name, args, self._utterance, self._light_names_fn, strict)
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
        if prep.scope and any(r.ok for r in out):
            self._guard.remember_scope("light", prep.scope)
        return out

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
            # Nothing sounds like it: say what there is (real names only).
            parts = [f"I couldn't find \"{content}\"."]
            if "experience" in kinds:
                parts.append(f"The experiences are: {', '.join(titles['experience'][:6]) or 'none'}.")
            if "media" in kinds:
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
        if runner is None:
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
