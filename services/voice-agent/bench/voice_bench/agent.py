"""The production TravisLocal, instrumented, with the outside world stubbed.

BenchAgent subclasses TravisLocal and calls its real __init__, so the command
matcher, relevance gate, prompt, tools, Ollama client and history are exactly
what runs in production. Only these are replaced:

  * the CMS        -> mock_cms.MockCms over real HTTP (cms_client's config is pointed at it)
  * speech output  -> captured text (ElevenLabs is never called unless a test asks for the real _say)
  * wake word / speaker extraction / microphone -> not constructed
  * knowledge_search (needs Gemini), save_memory (writes your memory file),
    shutdown_travis (would os._exit the benchmark) -> recorded stubs

Nothing in production code is modified; stages are timed by wrapping methods.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from unittest import mock as umock

AGENT_ROOT = Path(__file__).resolve().parents[2]
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from agent import tool_runner  # noqa: E402
from agent.local import TravisLocal  # noqa: E402
from agent.vocabulary import speakable  # noqa: E402
from actions import cms_client, device_control, safety, screen_control  # noqa: E402
from speech.stt import Transcript  # noqa: E402

from .mock_cms import MockCms  # noqa: E402


class FakeUI:
    muted = False

    def __init__(self):
        self.visuals: list[dict] = []

    def write_log(self, *_a):
        pass

    def set_state(self, *_a):
        pass

    def set_connection(self, *_a):
        pass

    def show_visual(self, card):
        self.visuals.append(card)

    def clear_visual(self):
        pass


class _FakeWake:
    label = "hey travis"


@dataclass
class Trace:
    command: str = ""
    t0: float = 0.0
    t_end: float = 0.0
    path: str | None = None  # "fast" | "llm" | "decline"
    intent: str | None = None
    gate: dict | None = None
    tools: list[dict] = field(default_factory=list)
    said: list[tuple[float, str]] = field(default_factory=list)
    llm_start: float | None = None
    llm_end: float | None = None
    llm_first_token: float | None = None
    error: str | None = None
    shutdown: bool = False
    stt_ms: float | None = None
    transcript: str | None = None
    language: str | None = None
    visuals: int = 0
    plan: dict | None = None  # what the planner understood, before anything reached the CMS

    @property
    def reply(self) -> str:
        return "".join(t for _, t in self.said).strip()

    def ms(self, a: float | None, b: float | None = None) -> float | None:
        return None if a is None else ((b if b is not None else a) - self.t0) * 1000


class TracingGate:
    def __init__(self, gate, agent):
        self._gate, self._agent = gate, agent

    def __getattr__(self, name):
        return getattr(self._gate, name)

    async def review(self, command, history=None, **kw):
        t = time.perf_counter()
        review = await self._gate.review(command, history, **kw)
        self._agent.trace.gate = {
            "allowed": review.allowed, "kept": review.command, "dropped": review.dropped,
            "ms": (time.perf_counter() - t) * 1000,
        }
        return review


class BenchAgent(TravisLocal):
    def __init__(self, real_say: bool = False, llm_temperature: float | None = None):
        self.trace = Trace()
        self.real_say = real_say
        self.shutdown_requests = 0
        self.stub_calls: list[tuple[str, dict]] = []
        super().__init__(FakeUI())
        self._xlog = None  # the benchmark's simulated exchanges don't belong in the real-voice log
        self._save_utterances = False  # nor do its clips belong in logs/utterances
        self._gate = TracingGate(self._gate, self)
        if llm_temperature is not None:
            self._llm._options["temperature"] = llm_temperature

    # production pieces that need hardware or downloads
    def _init_wake_word(self):
        self._wake_model = None
        self._awake = True

    def _init_speaker_extraction(self):
        self._extract_active = False

    # ── captured speech ──────────────────────────────────────────────────
    async def _say(self, text):
        if text.strip():
            self.trace.said.append((time.perf_counter(), speakable(text)))
        if self.real_say:
            await super()._say(text)

    async def _finish_reply(self):
        if self.real_say:
            await super()._finish_reply()
        else:
            self._reply_complete_at = time.monotonic()

    # ── tracing wrappers ─────────────────────────────────────────────────
    async def _run_fast_path(self, match):
        self.trace.path, self.trace.intent = "fast", match.intent
        return await super()._run_fast_path(match)

    async def _run_multi(self, steps):
        self.trace.path = self.trace.path or "multi"
        return await super()._run_multi(steps)

    async def _run_plan(self, request, fallback):
        # Counted with the model paths: it is Qwen (reading meaning) instead of Qwen (calling tools).
        self.trace.path = "llm"
        self.trace.llm_start = time.perf_counter()
        try:
            return await super()._run_plan(request, fallback)
        finally:
            self.trace.llm_end = time.perf_counter()
            self.trace.plan = self._plan_log

    async def _run_llm(self, command):
        self.trace.path = "list + llm" if self.trace.path == "multi" else "llm"
        self.trace.llm_start = time.perf_counter()
        try:
            return await super()._run_llm(command)
        finally:
            self.trace.llm_end = time.perf_counter()
            ft = self._timing.get("llm_first_token")
            if ft is not None:  # production stamps time.monotonic(); put it on the perf_counter clock
                self.trace.llm_first_token = time.perf_counter() - (time.monotonic() - ft)

    async def _call_tool(self, name, args):
        start = time.perf_counter()
        ok, message = await super()._call_tool(name, args)
        self.trace.tools.append(
            {"name": name, "args": dict(args), "ok": ok, "message": message, "start": start, "end": time.perf_counter()}
        )
        return ok, message

    async def _run_tool(self, name, args):
        if name == "shutdown_travis":
            self.shutdown_requests += 1
            self.trace.shutdown = True
            return "Shutting down."
        return await super()._run_tool(name, args)

    # ── driving it ───────────────────────────────────────────────────────
    def reset_context(self):
        self._history, self._history_at = [], 0.0
        self._exchange_active = False
        self._reply_complete_at = None
        self._nudge_state = "none"
        self._wake_confirmed = False
        self._wake_transcript = ""
        self._heard_command_speech = False
        self._awake = True
        device_control._last_device_target = None
        screen_control._last_screen_target = None
        self.stub_calls.clear()
        self._guard.reset()
        if self._planner is not None:
            self._focus.clear()
            self._plan_pending = None

    def begin_wake(self):
        """What TravisBase._listen_audio resets on a fresh wake word."""
        self._exchange_active = False
        self._exchange_is_nudge = False
        self._reply_complete_at = None
        self._nudge_state = "none"
        self._wake_transcript = ""
        self._wake_confirmed = False
        self._heard_command_speech = False
        self._awake = True

    def age_context(self, seconds: float):
        """Pretend `seconds` passed since the last exchange (history expiry)."""
        self._history_at -= seconds
        self._guard.age(seconds)
        if self._planner is not None:
            self._focus.age(seconds)

    def _begin(self, command: str) -> Trace:
        self.trace = Trace(command=command, t0=time.perf_counter())
        self._timing = {}
        return self.trace

    async def run(self, command: str) -> Trace:
        """One command, exactly as TravisLocal._run_command receives it (wake word already stripped)."""
        trace = self._begin(command)
        try:
            await self._run_command(command)
        except Exception as e:  # production would log this and stay silent
            trace.error = f"{type(e).__name__}: {e}"
        trace.t_end = time.perf_counter()
        trace.visuals = len(self.ui.visuals)
        return trace

    async def run_audio(self, pcm: bytes, wake_check: bool = True) -> Trace:
        """Real audio through the real Whisper, then TravisLocal._handle_utterance (the same code
        the mic loop calls once the VAD has cut an utterance)."""
        trace = self._begin("<audio>")
        real = self._stt

        def timed(p):
            t = time.perf_counter()
            out = real.transcribe(p)
            trace.stt_ms = (time.perf_counter() - t) * 1000
            trace.transcript, trace.language = out.text, out.language
            if out.rejected_language:
                trace.language = f"rejected:{out.rejected_language}"
            return out

        self._stt = SimpleNamespace(transcribe=timed)
        self._wake_model = _FakeWake() if wake_check else None
        self._ignore_before = 0.0
        # Wake state (_wake_confirmed, _nudge_state, ...) is NOT reset here: when the VAD splits
        # "Travis" from the rest of the command, production carries the confirmation across the two
        # utterances. begin_wake() resets it, as the mic callback does on a fresh wake word.
        try:
            await self._handle_utterance(pcm)
        except Exception as e:
            trace.error = f"{type(e).__name__}: {e}"
        finally:
            self._stt = real
        trace.t_end = time.perf_counter()
        return trace

    async def run_transcript(self, transcript: str, wake_check: bool = True, language: str = "en") -> Trace:
        """A Whisper transcript through TravisLocal._handle_utterance: language check,
        noise check, the wake-word double check, wake-word stripping, then the command."""
        trace = self._begin(transcript)
        self._stt = SimpleNamespace(
            transcribe=lambda pcm: Transcript(transcript, language, 0.95, 0.95 if language == "en" else 0.02,
                                              rejected_language=None if language == "en" else language)
        )
        self._wake_model = _FakeWake() if wake_check else None
        self._nudge_state = "none"
        self._wake_confirmed = False
        self._wake_transcript = ""
        self._ignore_before = 0.0
        try:
            await self._handle_utterance(b"\x00\x00" * 1600)
        except Exception as e:
            trace.error = f"{type(e).__name__}: {e}"
        trace.t_end = time.perf_counter()
        return trace


@contextlib.contextmanager
def bench_env(mock: MockCms):
    """Point cms_client at the mock and stub the tools that reach outside the process."""
    # config/test_safe.json has no real key or secret; safety mode stays ON, with this mock's (random) port the only one allowed.
    cfg = {**json.loads((AGENT_ROOT / "config" / "test_safe.json").read_text(encoding="utf-8")), "cms_api_base_url": mock.url}
    with contextlib.ExitStack() as stack:
        stack.enter_context(umock.patch.object(safety, "ALLOWED_PORTS", frozenset({mock.port})))
        stack.enter_context(umock.patch.object(cms_client, "_load_config", lambda: cfg))
        stack.enter_context(umock.patch.object(tool_runner, "knowledge_search", lambda query, api_key=None: "No relevant information found."))
        stack.enter_context(umock.patch.object(tool_runner, "update_memory", lambda data: None))
        cms_client._name_cache.clear()
        yield


def run_async(coro):
    return asyncio.run(coro)
