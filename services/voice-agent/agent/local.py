"""TravisLocal: the local pipeline (VAD, Whisper, fast path / Qwen, ElevenLabs)."""

from __future__ import annotations

import asyncio
import os
import time
import traceback
import uuid


# pyrefly: ignore [missing-import]

from ui import TravisUI
from speech.language_gate import is_english
from speech.transcript_gate import (

    has_speech_beyond_wake_word,
    is_noise,
    addressed_to,
    strip_markers,
    strip_wake_word,
)
from safety.action_guard import ActionGuard
from agent.exchange_log import ExchangeLog
from nlu.command_matcher import load_registry
from nlu import pending as pending_mod
from nlu.local_llm import OllamaChat, tools_to_json_schema
from nlu.intent import IntentCheck
from nlu.relevance import RelevanceGate
from speech.stt import WhisperSTT
from speech.vad import Endpointer
from actions import cms_client
from settings import (
    BASE_DIR, COMMANDS_PATH, LOCAL_PROMPT_PATH,
    RECEIVE_SAMPLE_RATE, SEND_SAMPLE_RATE, load_api_config,
)
from agent.tool_declarations import TOOL_DECLARATIONS
from agent.vocabulary import speakable, stt_vocabulary


from agent.base import TravisBase
from agent.commands import CommandMixin, _PendingHandled  # noqa: F401


class TravisLocal(CommandMixin, TravisBase):
    """TRAVIS on a local language model, with ElevenLabs for speech both ways:

  mic (while awake) -> WebRTC VAD endpointing (speech/vad.py)
    -> faster-whisper with English-only language check (speech/stt.py)
    -> config/commands.json fast path (nlu/command_matcher.py), or
       Qwen3 via Ollama with the same tools (nlu/local_llm.py)
    -> ElevenLabs, as before.

Everything else — mic capture, the Vosk wake word, chime, pre-roll, the
nudge after a bare "Travis", when the mic closes, playback, the tools —
is TravisBase's own code. There is no barge-in: the mic is ignored while
a command runs and while Travis speaks."""

    _NUDGE_REPLY = "Yes? What can I do for you?"

    _MAX_TOOL_ROUNDS = 4

    _HISTORY_MESSAGES = 12  # recent user/assistant lines kept for follow-ups

    _HISTORY_TTL_SEC = 300.0

    # The brightness request Travis last asked a question about (nlu/pending.py).
    _pending: "pending_mod.Pending | None" = None

    _TIMING_STAGES = [
        ("wake_detected", "wake_detected"),
        ("command_mode_started", "command_mode_started"),
        ("vad_speech_end", "vad_speech_end (+end silence)"),
        ("stt_done", "stt_done"),
        ("model_response_started", "command_started"),
        ("gate_done", "relevance_gate_done"),
        ("llm_first_token", "llm_first_token"),
        ("cms_request_started", "cms_request_started"),
        ("cms_response_received", "cms_response_received"),
        ("first_audio_chunk_received", "elevenlabs_first_audio_received"),
        ("playback_started", "playback_started"),
    ]

    def __init__(self, ui: TravisUI):
        super().__init__(ui)
        cfg = load_api_config()
        self._mic_q: asyncio.Queue | None = None
        # Mic audio captured before this moment belongs to an exchange that
        # has already been handled — never a new command.
        self._ignore_before = 0.0
        self._endpointer = Endpointer(
            sample_rate=SEND_SAMPLE_RATE,
            aggressiveness=int(cfg.get("vad_aggressiveness", 2)),
            end_ms=int(cfg.get("vad_end_silence_ms", 500)),
            max_ms=int(cfg.get("vad_max_utterance_ms", 12000)),
        )
        self._stt = None
        self._llm = OllamaChat(
            base_url=cfg.get("ollama_url", "http://127.0.0.1:11434"),
            model=cfg.get("llm_model", "qwen3:8b"),
            num_ctx=int(cfg.get("llm_num_ctx", 6144)),
            temperature=float(cfg.get("llm_temperature", 0.3)),
            keep_alive=cfg.get("llm_keep_alive", -1),
            max_tokens=int(cfg.get("llm_max_tokens", 200)),
        )
        # Off-topic requests (general knowledge, jokes, news...) get a fixed
        # refusal instead of an answer — see nlu/relevance.py.
        self._gate = RelevanceGate(self._llm, enabled=bool(cfg.get("relevance_gate", True)))
        self._intent = IntentCheck(self._llm, enabled=bool(cfg.get("intent_check", True)))
        self._off_topic_reply = str(
            cfg.get(
                "off_topic_reply",
                "Sorry, I can only help with this room, its screens and devices, and the experience center.",
            )
        )
        self._partial_reply = str(cfg.get("off_topic_partial_reply", "I can't help with the rest."))
        self._registry = load_registry(COMMANDS_PATH)
        self._match_opts = {
            "fuzzy": bool(cfg.get("fast_path_fuzzy", True)),
            "fuzzy_threshold": float(cfg.get("fast_path_fuzzy_threshold", 0.82)),
            "min_confidence": float(cfg.get("fast_path_min_confidence", 0.75)),
        }
        # knowledge_search embeds with Gemini (not a voice backend) — only offered when a key exists.
        declarations = [
            d
            for d in TOOL_DECLARATIONS
            if d["name"] != "knowledge_search" or cfg.get("gemini_api_key")
        ]
        self._llm_tools = tools_to_json_schema(declarations)
        self._system_prompt = LOCAL_PROMPT_PATH.read_text(encoding="utf-8")
        self._history: list[dict] = []
        self._history_at = 0.0
        self._command_lock = asyncio.Lock()
        # What "it" / "them" can mean, and the checks that stop guessing (safety/action_guard.py).
        self._guard = ActionGuard(self._registry, ttl=float(cfg.get("context_ttl_sec", 120)))
        self._light_names_fn = self._fetch_light_names
        self._utterance = ""
        # One line per exchange in logs/exchanges.jsonl, for reviewing real-voice tests.
        self._xlog = ExchangeLog(BASE_DIR / "logs" / "exchanges.jsonl") if cfg.get("exchange_log", True) else None
        self._calls_log: list[dict] = []
        self._path: str | None = None
        self._first_say: float | None = None
        self._last_heard: dict = {}

    # ── Hooks into TravisBase's mic callback ─────────────────────────────
    def _on_wake(self):
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._endpointer.reset)

    def _enqueue_out(self, item):
        """Awake mic audio goes to the VAD (runs on the
        event loop — the mic callback schedules it there)."""
        q = self._mic_q
        if q is None:
            return
        try:
            q.put_nowait((time.monotonic(), item["data"]))
        except asyncio.QueueFull:
            self._wake_stats["drop_full"] += 1

    def speak(self, text: str):
        """Say `text` now — the nudge (from the audio thread), a tool error,
        or shutdown's goodbye. There's no model to prompt, so it's spoken
        as-is."""
        if self._loop is not None:
            asyncio.run_coroutine_threadsafe(self._speak_async(text), self._loop)

    async def _speak_async(self, text: str):
        if text == self._NUDGE_TEXT:
            # Marks the exchange as answered
            # state, so _awake_action moves on to "wait_for_command".
            self._on_model_activity()
            self._reply_complete_at = None
            print(f"[Voice Agent] 💬 TRAVIS: {self._NUDGE_REPLY}")
            self.ui.write_log(f"TRAVIS: {self._NUDGE_REPLY}")
            await self._say(self._NUDGE_REPLY)
            await self._finish_reply()
            return
        await self._say(text)
        if not self._command_lock.locked():
            await self._finish_reply()

    # ── Speech out ───────────────────────────────────────────────────────
    async def _say(self, text: str):
        text = speakable(text)
        if not text.strip():
            return
        if self._first_say is None:
            self._first_say = time.monotonic()
        self._on_model_activity()
        if self.elevenlabs is not None:
            await self.elevenlabs.send_text(text.rstrip() + " ")

    async def _finish_reply(self):
        if self.elevenlabs is not None:
            await self.elevenlabs.flush()
        now = time.monotonic()
        self._reply_complete_at = now
        self._last_model_activity = now

    # ── Utterances ───────────────────────────────────────────────────────
    async def _utterance_loop(self):
        mic_q = self._mic_q
        assert mic_q is not None
        while True:
            captured_at, pcm = await mic_q.get()
            with self._speaking_lock:
                speaking = self._is_speaking
            if os.getenv("TRAVIS_DEBUG_WAKE") == "1" and self._awake and (
                self.ui.muted or speaking or self._exchange_active or captured_at < self._ignore_before
            ):
                print(
                    f"[Voice Agent] 🐞 utterance loop dropped a chunk: muted={self.ui.muted} "
                    f"speaking={speaking} exchange_active={self._exchange_active} "
                    f"stale={captured_at < self._ignore_before}"
                )
            if (
                not self._awake
                or self.ui.muted
                or speaking
                or self._exchange_active
                or captured_at < self._ignore_before
            ):
                # Asleep, Travis's own voice, or after a command was taken
                # (follow-ups need "Travis" again): never a new command.
                self._endpointer.reset()
                continue
            for utterance in self._endpointer.feed(pcm):
                self._timing["vad_speech_end"] = time.monotonic()
                try:
                    await self._handle_utterance(utterance)
                except Exception as e:
                    print(f"[Voice Agent] ⚠️ Utterance handling failed: {e}")
                    traceback.print_exc()
                break

    async def _handle_utterance(self, pcm: bytes):
        stt = self._stt
        if stt is None:
            return
        seconds = len(pcm) / 2 / SEND_SAMPLE_RATE
        if os.getenv("TRAVIS_DEBUG_WAKE") == "1":
            import wave

            wav_path = BASE_DIR / "logs" / f"utt_{int(time.time())}.wav"
            with wave.open(str(wav_path), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(SEND_SAMPLE_RATE)
                w.writeframes(pcm)
            print(f"[Voice Agent] 🐞 utterance {seconds:.1f}s saved to {wav_path.name}")
        transcript = await asyncio.get_running_loop().run_in_executor(None, stt.transcribe, pcm)
        self._timing["stt_done"] = time.monotonic()
        if transcript.rejected_language:
            print(
                f"[Voice Agent] 🔇 Ignoring {seconds:.1f}s of speech (not English: "
                f"{transcript.rejected_language} {transcript.language_prob:.2f}, "
                f"en {transcript.english_prob:.2f}, {transcript.ms:.0f}ms)."
            )
            self._log_ignored(f"not English: {transcript.rejected_language} {transcript.language_prob:.2f}", "")
            return
        text = transcript.text.strip()
        self._last_heard = {
            "text": text, "language": transcript.language, "language_prob": round(transcript.language_prob, 2),
            "stt_ms": round(transcript.ms), "seconds": round(seconds, 1),
        }
        print(
            f"[Voice Agent] 📝 Heard {seconds:.1f}s in {transcript.ms:.0f}ms "
            f"({transcript.language} {transcript.language_prob:.2f}): {text!r}"
        )
        if not text or transcript.no_speech or is_noise(text):
            self._log_ignored("noise / no speech", text)
            return
        if not is_english(strip_markers(text)):
            print("[Voice Agent] 🔇 Ignoring this turn (not English).")
            self._log_ignored("not English (script)", text)
            return

        label = self._wake_model.label if self._wake_model else "travis"
        if self._wake_model is not None and self._nudge_state == "none":
            # Vosk's wake is double-checked against Whisper, as it was
            # against the speech-to-text transcript.
            self._wake_transcript += " " + text
            if addressed_to(text, label):
                self._wake_confirmed = True
            elif not self._wake_confirmed:
                print("[Voice Agent] 🔇 Ignoring this turn (false wake).")
                self._log_ignored("false wake: no 'travis' in what was heard", text)
                self._enter_standby("false wake — no 'travis' in what was heard")
                if not self.ui.muted:
                    self.ui.set_state("THINKING")
                return

        command = strip_wake_word(text, label)
        if not has_speech_beyond_wake_word(command, label):
            self._log_ignored("only the wake word: waiting for the request", text)
            return  # just "Hey Travis": the nudge asks what they want
        self._heard_command_speech = True
        try:
            await self._run_command(command)
        finally:
            self._ignore_before = time.monotonic()
            self._endpointer.reset()

    def _log_ignored(self, reason: str, text: str) -> None:
        if self._xlog is not None:
            self._xlog.write({"ignored": reason, "text": text, "heard": self._last_heard})

    # ── Startup ──────────────────────────────────────────────────────────
    async def _warm_llm(self):
        try:
            await self._llm.check()
            seconds = await self._llm.warm(
                [{"role": "system", "content": self._system_prompt}], self._llm_tools
            )
            print(f"[Voice Agent] ✅ {self._llm.model} loaded and primed ({seconds:.1f}s).")
        except Exception as e:
            print(
                f"[Voice Agent] ⚠️ Local LLM unavailable ({e}). Commands in "
                "config/commands.json still work; anything else will fail until it's up."
            )

    def _load_stt(self, cfg: dict):
        prompt, hot = stt_vocabulary(self._registry, cfg)
        return WhisperSTT(
            model=cfg.get("stt_model", "small"),
            device=cfg.get("stt_device", "cuda"),
            compute_type=cfg.get("stt_compute_type", "float16"),
            hotwords=hot,
            initial_prompt=prompt,
            cuda_lib_dir=cfg.get("stt_cuda_lib_dir") or None,
            reject_threshold=float(cfg.get("stt_reject_language_threshold", 0.5)),
            english_floor=float(cfg.get("stt_english_floor", 0.15)),
        )

    async def run(self):
        loop = asyncio.get_running_loop()
        self._loop = loop
        self.audio_in_queue = asyncio.Queue()
        self._mic_q = asyncio.Queue(maxsize=512)
        cfg = load_api_config()
        self.ui.set_state("THINKING")
        self.ui.set_connection("connecting")

        el_key = cfg.get("elevenlabs_api_key", "").strip()
        el_voice = cfg.get("elevenlabs_voice_id", "").strip()
        el_model = cfg.get("elevenlabs_model_id", "eleven_flash_v2_5").strip()
        if el_key and el_voice:
            from speech.elevenlabs_stream import ElevenLabsStreamer

            self.elevenlabs = ElevenLabsStreamer(
                api_key=el_key,
                voice_id=el_voice,
                model_id=el_model,
                sample_rate=RECEIVE_SAMPLE_RATE,
                audio_queue=self.audio_in_queue,
            )
            print(f"[Voice Agent] 🎙️ ElevenLabs TTS active (voice: {el_voice}, model: {el_model}).")
        else:
            print("[Voice Agent] ⚠️ ElevenLabs not configured — no spoken audio.")

        print("[Voice Agent] 🧠 Loading speech-to-text: whisper...")
        started = time.monotonic()
        self._stt = await loop.run_in_executor(None, self._load_stt, cfg)
        print(f"[Voice Agent] ✅ whisper ready on {self._stt.device} ({time.monotonic() - started:.1f}s).")
        asyncio.create_task(self._warm_llm())

        cms_client.set_session_id(str(uuid.uuid4()))
        label = self._wake_model.label if self._wake_model else "travis"
        print(f"[Voice Agent] ✅ Local pipeline ready — say '{label}' to talk.")
        self.ui.set_connection("online")
        self.ui.write_log("SYS: Voice agent online (local).")
        await asyncio.gather(self._listen_audio(), self._play_audio(), self._utterance_loop())
