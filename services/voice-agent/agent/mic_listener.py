"""Microphone capture while awake: gain, wake detection, pre-roll and routing."""

from __future__ import annotations

import asyncio
import os
import queue
import time


# pyrefly: ignore [missing-import]
import sounddevice as sd

from settings import (
    CHANNELS, CHUNK_SIZE, SEND_SAMPLE_RATE, load_api_config,
)
from audio.devices import apply_gain, chunk_rms, resolve_input_device


class MicListenerMixin:
    """Microphone capture while awake: gain, wake detection, pre-roll and routing."""

    def _clear_preroll(self):
        self._preroll_pcm.clear()

    async def _listen_audio(self):
        print("[Voice Agent] 🎤 Mic started")
        loop = asyncio.get_event_loop()

        # Rolling preroll buffer: keep the last ~1.0s of audio so single-sentence
        # wake-and-command utterances ("Travis, turn off the lights") don't lose
        # the initial syllables while the wake word was being detected.
        # 16 chunks @ 1024 samples / 16kHz = 1.024s.
        preroll_pcm = self._preroll_pcm

        # TRAVIS_DEBUG_WAKE=1: on standby, print what the wake-word decoder
        # is hearing (rate-limited) — tells "heard speech but not 'travis'"
        # apart from "heard nothing" when a wake word is missed.
        debug_wake = os.getenv("TRAVIS_DEBUG_WAKE") == "1"
        dbg = {"last": "", "t": 0.0}

        def _safe_enqueue(item):
            self._enqueue_out(item)

        def callback(indata, frames, time_info, status):
            with self._speaking_lock:
                travis_speaking = self._is_speaking
                tool_active = self._tool_active

            data = indata.tobytes()
            preroll_pcm.append(data)
            # Set below when this exact chunk gets flushed as the tail of
            # preroll_pcm on a fresh wake — the "stream while awake" block
            # further down must not send it again this same callback, or
            # whatever word straddles that chunk gets duplicated in the
            # command audio (found live: "Travis, can you hear me" came out
            # "Travis can CAN you hear me" — the wake-triggering chunk was
            # going out via the preroll flush AND the per-chunk streamer in
            # the same invocation, since self._awake flips true in between).
            just_flushed_in_preroll = False

            # Local wake-word pass (only meaningful while a detector exists and
            # we're not playing the agent's own audio back into the mic).
            if not travis_speaking and not tool_active and not self.ui.muted:
                if self._detect_wake_word(data):
                    if not self._awake:
                        # Real-mic wake lag: walk back from the newest chunk
                        # through the contiguous voiced run to where it began.
                        # "Voiced" is relative to this room's noise floor (the
                        # quietest chunk in the pre-roll), not a fixed level —
                        # a fixed cutoff read a quiet mic as never voiced.
                        levels = [chunk_rms(c) for c in preroll_pcm]
                        cutoff = max(min(levels) * 3.0, 0.002)
                        voiced = 0
                        for lvl in reversed(levels):
                            if lvl < cutoff:
                                break
                            voiced += 1
                        print(
                            "[Voice Agent] 🟢 Wake word — engaged "
                            f"(~{voiced * CHUNK_SIZE * 1000 // SEND_SAMPLE_RATE}ms after speech onset)."
                        )
                        self.ui.set_state("LISTENING")
                        self._play_chime()
                        self._wake_engaged_at = time.monotonic()
                        # Per-exchange latency stages (see _print_timing_report):
                        # wake detected now, command mode starts right after
                        # the pre-roll is flushed below.
                        self._timing = {"wake_detected": self._wake_engaged_at}
                        # A fresh exchange: nothing answered yet, nobody nudged.
                        self._exchange_active = False
                        self._exchange_is_nudge = False
                        self._reply_complete_at = None
                        self._nudge_state = "none"
                        self._wake_transcript = ""
                        self._wake_confirmed = False
                        self._heard_command_speech = False
                        self._voiced_cutoff = cutoff
                        self._last_voiced_at = time.monotonic()
                        self._wake_stats = {
                            "sent": len(preroll_pcm),
                            "drop_speaking": 0,
                            "drop_tool": 0,
                            "drop_full": 0,
                        }
                        # Awake BEFORE the pre-roll flush is scheduled: the event
                        # loop can run the first flushed chunk before this thread
                        # reaches the `self._awake = True` below, and the utterance
                        # loop discards audio while not awake — which ate "Hey
                        # Travis" itself and made Whisper's check call it a false wake.
                        self._awake = True
                        self._on_wake()
                        self._timing["command_mode_started"] = time.monotonic()
                        # Kick off ElevenLabs' TLS+auth handshake now, in the
                        # background, so it overlaps with the user speaking
                        # their command instead of starting cold after the reply is
                        # ready. Safe every wake word: ensure_session() no-ops once a
                        # session is open. self.elevenlabs is None until run() has
                        # created it — skip silently then.
                        if self.elevenlabs is not None:
                            asyncio.run_coroutine_threadsafe(
                                self.elevenlabs.prewarm(), loop
                            )
                        # ponytail: flush pre-roll audio so single-breath "Travis <command>" preserves opening words
                        self._timing["preroll_flush_started"] = time.monotonic()
                        for chunk in preroll_pcm:
                            loop.call_soon_threadsafe(
                                _safe_enqueue,
                                {"data": chunk, "mime_type": "audio/pcm"},
                            )
                        self._timing["preroll_flush_completed"] = time.monotonic()
                        just_flushed_in_preroll = True
                    self._awake = True
                    self._awake_until = time.monotonic() + self._awake_timeout
                    if self._extract_active:
                        # Off the audio thread: speaker.embed() is a real
                        # neural-net forward pass (measured: up to ~750ms on
                        # a cold first call in a fresh process) — calling it
                        # inline here would block the audio driver's own
                        # callback for that whole time, risking dropped mic
                        # frames. The worker already has a "wake" handler for
                        # exactly this; _extract_gain_target starts at 1.0,
                        # so audio keeps flowing at full volume regardless of
                        # how long enrollment takes.
                        try:
                            self._extract_q.put_nowait(
                                ("wake", b"".join(preroll_pcm))
                            )
                        except queue.Full:
                            pass

            elif self._wake_model is not None and not self.ui.muted:
                # Travis is speaking or a tool is running, so a wake word is
                # deliberately not acted on (his own voice must not trigger
                # it). Keep the decoder fed anyway — skipping chunks leaves
                # it resuming from stale state — and say so if "Travis" was
                # heard in the meantime, since that looks identical to a
                # missed wake word from the outside.
                if self._wake_model.detect(data):
                    print(
                        "[Voice Agent] 🔕 Wake word heard while Travis was "
                        "speaking / busy — ignored."
                    )

            if debug_wake and not self._awake and self._wake_model is not None:
                partial = getattr(self._wake_model, "last_partial", "")
                now = time.monotonic()
                if partial and partial != dbg["last"] and now - dbg["t"] > 1.0:
                    dbg["last"], dbg["t"] = partial, now
                    print(f"[Voice Agent] 👂 Decoder hears: {partial!r}")

            # Track when the user is actually talking, so "Travis" followed by
            # 2 seconds of silence can be told apart from a command in progress.
            now = time.monotonic()
            if (
                self._awake
                and not travis_speaking
                and chunk_rms(data) >= self._voiced_cutoff
            ):
                self._last_voiced_at = now

            # One request per wake word. The mic closes only when the whole
            # exchange is over (see _awake_action); if nothing follows the
            # wake word, Travis asks what the user wants, then gives up.
            q = self.audio_in_queue
            busy = travis_speaking or bool(tool_active) or (q is not None and not q.empty())
            action = self._awake_action(now, busy)
            if action == "standby":
                self._enter_standby(
                    "request answered" if self._exchange_active else "no request heard"
                )
                if not self.ui.muted:
                    self.ui.set_state("THINKING")
            elif action == "nudge":
                self._nudge_state = "sent"
                self._exchange_is_nudge = True
                print("[Voice Agent] 🙋 No command after the wake word — asking what you need.")
                self.speak(self._NUDGE_TEXT)
            elif action == "wait_for_command":
                # The prompt has been spoken; keep the mic open for the real
                # request (no second "Travis" needed) and start a fresh wait.
                self._exchange_active = False
                self._exchange_is_nudge = False
                self._reply_complete_at = None
                self._nudge_state = "done"
                self._last_voiced_at = now
                self._awake_until = now + self._awake_timeout
                print(
                    "[Voice Agent] 🟡 Prompt spoken — listening for your request "
                    "(no need to say Travis again)."
                )

            # Count audio that can't be sent right now, for the standby summary.
            if self._awake and not self.ui.muted and not self._extract_active:
                if tool_active:
                    self._wake_stats["drop_tool"] += 1
                elif travis_speaking:
                    self._wake_stats["drop_speaking"] += 1

            # Feed the recognizer only while awake and not muted/busy with a tool.
            # not just_flushed_in_preroll: this exact chunk already went out
            # as the tail of preroll_pcm a few lines up on a fresh wake —
            # sending it again here would duplicate whatever word straddles
            # it (see just_flushed_in_preroll's definition above).
            if (
                self._awake
                and not tool_active
                and not self.ui.muted
                and not just_flushed_in_preroll
            ):
                if self._extract_active:
                    # Continuous target-speaker extraction: every chunk is
                    # forwarded, always — never blocked or delayed waiting on
                    # verification — just scaled by however well the last
                    # analyzed window matched the enrolled voice. Gain ramps
                    # (not steps) toward the worker's latest estimate each
                    # callback so volume changes fade instead of clicking.
                    # Runs even while TRAVIS is speaking: pure TTS echo scores
                    # far below the (relaxed, see the worker) match bar and
                    # gets suppressed, while genuine barge-in still gets
                    # through — the same barge-in behavior the old gate had.
                    self._extract_gain_applied += (
                        self._extract_gain_target - self._extract_gain_applied
                    ) * 0.35
                    scaled = apply_gain(data, self._extract_gain_applied)
                    self._timing.setdefault(
                        "first_extracted_chunk_sent", time.monotonic()
                    )
                    self._wake_stats["sent"] += 1
                    loop.call_soon_threadsafe(
                        _safe_enqueue, {"data": scaled, "mime_type": "audio/pcm"}
                    )
                    try:
                        self._extract_q.put_nowait(("audio", data))
                    except queue.Full:
                        pass
                elif not travis_speaking:
                    self._wake_stats["sent"] += 1
                    loop.call_soon_threadsafe(
                        _safe_enqueue, {"data": data, "mime_type": "audio/pcm"}
                    )

        cfg = load_api_config()
        input_device = resolve_input_device(cfg.get("mic_device_name", ""))

        # A mic-driver hiccup (device busy, momentarily unplugged, a transient
        # PortAudio error — the kind seen in practice as PaErrorCode -9999)
        # used to propagate out of this coroutine and take the whole agent down, for
        # what is usually a purely local audio problem. Retry opening the stream here
        # instead — mirrors _play_audio's degrade-and-continue pattern, except recovery
        # here means the mic starts working again.
        backoff = 1.0
        while True:
            try:
                with sd.InputStream(
                    device=input_device,
                    samplerate=SEND_SAMPLE_RATE,
                    channels=CHANNELS,
                    dtype="int16",
                    blocksize=CHUNK_SIZE,
                    callback=callback,
                ):
                    print("[Voice Agent] 🎤 Mic stream open")
                    backoff = 1.0
                    while True:
                        await asyncio.sleep(0.1)
            except Exception as e:
                print(f"[Voice Agent] ⚠️ Mic error ({e}). Retrying in {backoff:.0f}s...")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)
