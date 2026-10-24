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
from audio.devices import AudioDeviceMissing, apply_gain, chunk_rms, resolve_input_device
from audio.metrics import CaptureMeter


class MicListenerMixin:
    """Microphone capture while awake: gain, wake detection, pre-roll and routing."""

    _MIC_BACKOFF_MAX_S = 5.0  # longest wait before reopening the mic, whatever the error

    async def _prewarm_stt(self):
        """Overridden where there is a local speech-to-text model (agent/local.py)."""

    _REWAKE_DEBOUNCE_S = 1.5

    def _turn_busy(self) -> bool:
        """Overridden in agent/local.py: True while a request is being worked on."""
        return False

    def _barge_in(self):
        """Overridden in agent/local.py: drop the request in progress. Runs on the event loop."""

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
            # Level / clipping / overflow bookkeeping only; the audio is not touched.
            self._capture_meter.feed(data, status)
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
                    rewake = self._awake and (self._turn_busy() or self._exchange_active)
                    last_wake = getattr(self, "_wake_engaged_at", None) or 0.0
                    if rewake and time.monotonic() - last_wake < self._REWAKE_DEBOUNCE_S:
                        rewake = False  # the same wake word, seen on a second chunk
                    if rewake:
                        print("[Voice Agent] 🔁 Wake word during a request — dropping it and starting over.")
                        # Must be scheduled BEFORE _play_chime and the pre-roll flush in the block below
                        # (call_soon_threadsafe callbacks run in order).
                        loop.call_soon_threadsafe(self._barge_in)
                    if not self._awake or rewake:
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
                        self._followup_wanted = False
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
                        # Same idea for the GPU: ramp Whisper up while the command is spoken.
                        asyncio.run_coroutine_threadsafe(self._prewarm_stt(), loop)
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
            elif action == "followup":
                # Travis's question has finished playing: a short cue, then a window (followup_window_sec) in which the answer needs
                # no "Hey Travis". The cue's own echo must not be heard as speech, so audio from the next half second is ignored.
                window = float(load_api_config().get("followup_window_sec", 8) or 0)
                self._followup_wanted = False
                self._exchange_active = False
                self._exchange_is_nudge = False
                self._reply_complete_at = None
                self._nudge_state = "done"
                self._last_voiced_at = now
                self._awake_until = now + window
                self._ignore_before = now + 0.5
                self._play_cue()
                print(f"[Voice Agent] 🟡 Question asked — listening for your answer for {window:.0f}s (no need to say Hey Travis).")
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

        await self._supervise_mic(callback, load_api_config())

    async def _supervise_mic(self, callback, cfg: dict):
        """Keep the mic stream open, whatever Bluetooth does.

        A mic-driver hiccup (device busy, a transient PortAudio error — seen as
        PaErrorCode -9999) must not take the agent down, and a Bluetooth drop must not
        leave it listening to nothing (or to the wrong mic). Each pass re-resolves the
        device by name; a named device that is missing is waited for, not replaced by
        the OS default (unless `audio_allow_default_fallback`). After repeated failures,
        a stalled stream or a speaker that won't reopen, PortAudio is re-initialised so
        a reconnected device's new entry is visible (see _reinit_audio).
        """
        hint = cfg.get("mic_device_name", "")
        strict = bool(hint) and not cfg.get("audio_allow_default_fallback", False)
        stall_s = float(cfg.get("mic_stall_sec", 2.5))
        dead_s = float(cfg.get("mic_dead_sec", 30.0))
        first_audio_s = float(cfg.get("mic_first_audio_sec", 5.0))  # BT hands-free needs ~1.2 s to start
        backoff = 1.0
        failures = 0
        last_msg = ("", 0.0)
        reinit = False
        while True:
            self._capture_meter = CaptureMeter(chunk_samples=CHUNK_SIZE, sample_rate=SEND_SAMPLE_RATE)
            meter = self._capture_meter
            try:
                if reinit:
                    await self._reinit_audio()
                    reinit = False
                device = resolve_input_device(hint, strict=strict)
                stream = sd.InputStream(
                    device=device,
                    samplerate=SEND_SAMPLE_RATE,
                    channels=CHANNELS,
                    dtype="int16",
                    blocksize=CHUNK_SIZE,
                    callback=callback,
                )
                with stream:
                    fmt_ok = (
                        int(stream.samplerate) == SEND_SAMPLE_RATE
                        and stream.channels == CHANNELS
                        and "int16" in str(stream.dtype)
                    )
                    info = sd.query_devices(stream.device) if stream.device is not None else {}
                    print(
                        f"[Voice Agent] 🎤 Mic stream open: {info.get('name', '?')} — "
                        f"{stream.samplerate:.0f}Hz, {stream.channels}ch, {stream.dtype}, "
                        f"{CHUNK_SIZE}-sample chunks" + ("" if fmt_ok else "  ⚠️ NOT 16 kHz mono int16")
                    )
                    opened_at = time.monotonic()
                    reported_at = opened_at
                    warned_dead = False
                    while True:
                        await asyncio.sleep(0.1)
                        now = time.monotonic()
                        if meter.chunks:
                            failures, backoff = 0, 1.0
                        if meter.chunks == 0 and now - opened_at > first_audio_s:
                            raise RuntimeError("no audio ever arrived from the mic")
                        if meter.chunks and meter.seconds_since_chunk(now) > stall_s:
                            raise RuntimeError(
                                f"mic stopped delivering audio ({meter.seconds_since_chunk(now):.1f}s without a chunk)"
                            )
                        if meter.dead_input(now, after_s=min(3.0, dead_s / 2)):
                            if not warned_dead:
                                warned_dead = True
                                print("[Voice Agent] ⚠️ Mic is sending digital silence — muted, or the Bluetooth link is dead.")
                            if meter.seconds_dead(now) > dead_s:
                                raise RuntimeError(f"mic silent for {dead_s:.0f}s — reopening")
                        else:
                            warned_dead = False
                        if self._audio_reset_wanted:
                            self._audio_reset_wanted = False
                            reinit = True
                            raise RuntimeError("speaker would not reopen — resetting audio")
                        if now - reported_at >= 60.0:
                            reported_at = now
                            problems = meter.problems()
                            if problems:
                                print(f"[Voice Agent] 🎚️ Mic, last minute: {'; '.join(problems)} — {meter.summary()}")
                            elif os.getenv("TRAVIS_DEBUG_WAKE") == "1":
                                print(f"[Voice Agent] 🎚️ Mic: {meter.summary()}")
                            meter.reset_counters()
            except Exception as e:
                failures += 1
                self._audio_events["mic_reopen"] = self._audio_events.get("mic_reopen", 0) + 1
                missing = isinstance(e, AudioDeviceMissing)
                msg = f"{'Mic not connected' if missing else 'Mic error'} ({e})"
                # Waiting for a device to come back would otherwise print every second.
                if msg != last_msg[0] or time.monotonic() - last_msg[1] > 30.0:
                    print(f"[Voice Agent] ⚠️ {msg}. Retrying — Travis can't hear until it is back.")
                    last_msg = (msg, time.monotonic())
                if failures >= 3 or (missing and failures % 5 == 0):
                    reinit = True
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, self._MIC_BACKOFF_MAX_S)
