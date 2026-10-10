"""Self-repair in the conversation (nlu/repair_resolver.py): where "Tell me about yourself, no?" / "..., actually the fan" / "ok wait, the other screen" are
settled before the request is understood or run.

Runs in agent/commands.py right after a pending answer and BEFORE anything is understood or executed, so a withdrawn request can never fire:

    plain turn          `needs_resolver` (one regex, microseconds) says no cue -> nothing else here runs, no model is called
    cue turn            tag questions and compose-able corrections are settled in code; only what code cannot decide costs ONE small model call
                        (classify: ~0.4 s), and a correction that cannot be composed costs a second (rewrite: <= 1 s)

The resolver runs ALONE, never beside the planner: Ollama serves one request at a time, so a parallel run only makes it wait behind the planner. For the
same reason there is no speculative planning on the raw text: the planner (and every other route) starts only after this step has decided.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from nlu import repair_resolver as rr
from nlu import repairs, title_match
from nlu.command_matcher import match_command, resolve
from nlu.multi_action import resolve_multi
from safety.reply_guard import with_wake_hint

PREVIOUS_TTL_SEC = 120.0  # how long "the other screen" still means the previous request
ASK_TTL_SEC = 45.0  # how long "go ahead" still answers "should I stop, or go ahead with that?"


@dataclass
class RepairOutcome:
    kind: str = "pass"  # pass | cancel | rewrite | ask
    command: str = ""  # rewrite: the request to use instead
    reply: str = ""  # ask: the question


class RepairMixin:
    _repair: "rr.RepairResolver | None" = None
    _repair_ask: "tuple[str, float] | None" = None  # (the request to run on "go ahead", when asked)
    _repair_log: dict | None = None
    _prev_turn: dict | None = None  # {"request", "reply", "action", "at"}: the previous request, for "ok wait, the other screen"

    def _init_repair(self, llm, cfg: dict) -> None:
        """Created once at startup and shared: the same OllamaChat (one connection pool, model kept loaded) as the planner."""
        if cfg.get("repair_resolver", True):
            self._repair = rr.RepairResolver(
                llm, timeout_ms=float(cfg.get("repair_timeout_ms", 700)), rewrite_timeout_ms=float(cfg.get("repair_rewrite_timeout_ms", 1000)),
                min_confidence=float(cfg.get("repair_min_confidence", 0.6)))

    # ── the previous request ─────────────────────────────────────────────
    def _remember_turn(self, request: str, reply: str) -> None:
        """What was asked and what it did, so a later correction can refer to it. Written only for turns that did something or answered."""
        action = []
        for c in self._calls_log[:3]:
            a = c.get("args") or {}
            bits = [str(a.get(k)) for k in ("action", "command", "target", "screen", "content", "brightness") if a.get(k) not in (None, "")]
            action.append(f"{c.get('name')} {' '.join(bits)}".strip())
        self._prev_turn = {"request": request, "reply": reply, "action": "; ".join(action), "at": time.monotonic()}

    def _previous(self) -> tuple[str, str, str]:
        p = self._prev_turn
        if not p or time.monotonic() - p["at"] > PREVIOUS_TTL_SEC:
            return "", "", ""
        return p["request"], p["reply"], p["action"]

    # ── the step ─────────────────────────────────────────────────────────
    def _asked(self, request: str) -> RepairOutcome:
        self._repair_ask = (request, time.monotonic())
        return RepairOutcome("ask", reply=with_wake_hint(rr.CLARIFY, self._wake_hint))

    def _full_command(self, text: str) -> bool:
        """`text` is a whole known command (the existing correction logic runs it as it is)."""
        m = match_command(text, self._registry, **self._match_opts) if text else None
        return bool(text) and ((m is not None and resolve(m).kind == "tool") or bool(resolve_multi(text, self._registry, **self._match_opts)))

    async def _repair_step(self, command: str) -> RepairOutcome:
        self._repair_log = None
        waiting, self._repair_ask = self._repair_ask, None
        if waiting is not None and time.monotonic() - waiting[1] <= ASK_TTL_SEC:
            answer = title_match.offer_answer(command)
            if answer == "yes":
                self._repair_log = {"kind": "confirmed", "source": "answer", "resolved": waiting[0]}
                return RepairOutcome("rewrite", waiting[0])
            if answer == "no":
                self._repair_log = {"kind": "cancel", "source": "answer"}
                return RepairOutcome("cancel")
        if self._repair is None or not rr.needs_resolver(command):
            return RepairOutcome()  # a plain turn: nothing more here
        if repairs.ends_with_retraction(command) or repairs.is_cancel(command):
            return RepairOutcome()  # the rule in nlu/repairs.py (unchanged): the caller cancels
        started = time.perf_counter()

        def settled(kind: str, source: str, resolved: str = "") -> None:
            self._repair_log = {"kind": kind, "source": source, "ms": round((time.perf_counter() - started) * 1000), **({"resolved": resolved} if resolved else {})}
            line = f"[Voice Agent] 🩹 Repair: {kind} ({source})" + (f" -> {resolved!r}" if resolved else "")
            try:
                print(line, flush=True)
            except UnicodeEncodeError:
                print(line.encode("ascii", "replace").decode("ascii"), flush=True)

        # 1. a tag question, in code
        tag = rr.tag_split(command)
        if tag is not None:
            if tag.certain:
                settled("tag_question", "tag", tag.request)
                return RepairOutcome("rewrite", tag.request)
            settled("tag_before_action", "tag", tag.request)  # a bare "no" after a device action: never guess, ask
            return self._asked(tag.request)
        # 2. a correction with a marker: a whole command after it is the existing logic's job; otherwise compose it in code
        if repairs.has_marker(command):
            after = repairs.last_version(command)
            if after and self._full_command(after):
                return RepairOutcome()
            fix = repairs.split_correction(command)
            if fix:
                composed = rr.compose_correction(*fix)
                if composed and not rr._same(composed, command):
                    settled("correction", "split", composed)
                    return RepairOutcome("rewrite", composed)
        # 3. what code cannot decide: one small call to the local model
        last_request, last_reply, last_action = self._previous()
        decision = await self._repair.classify(command, last_request, last_reply, last_action)
        self._repair_log = decision.as_log()
        if decision.kind == "cancel":
            return RepairOutcome("cancel")
        if decision.kind == "unclear":
            return self._asked(command)
        if decision.kind == "correction":
            fixed = await self._repair.rewrite(command, last_request, last_reply, last_action)
            self._repair_log = {**decision.as_log(), "rewrite": fixed.as_log()}
            if fixed.kind == "correction":
                return RepairOutcome("rewrite", fixed.resolved_request)
        return RepairOutcome()

    def _repair_waiting(self) -> bool:
        return self._repair_ask is not None and time.monotonic() - self._repair_ask[1] <= ASK_TTL_SEC
