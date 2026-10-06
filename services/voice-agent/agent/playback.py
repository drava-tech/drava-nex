"""Speaker playback: output stream, chime and the audio queue."""

from __future__ import annotations

import asyncio
import os
import threading
import time

import numpy as np

# pyrefly: ignore [missing-import]
import sounddevice as sd

from settings import (
    CHANNELS, CHUNK_SIZE, RECEIVE_SAMPLE_RATE, load_api_config,
)
from audio.devices import apply_gain, resolve_output_device


class PlaybackMixin:
    """Speaker playback: output stream, chime and the audio queue."""

    def set_speaking(self, value: bool):
        with self._speaking_lock:
            self._is_speaking = value
        if value:
            self.ui.set_state("SPEAKING")
        elif not self.ui.muted:
            self.ui.set_state("LISTENING")

    def _drain_audio_queue(self):
        if self.elevenlabs is not None:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self.elevenlabs.cancel())
            except RuntimeError:
                if self._loop and self._loop.is_running():
                    asyncio.run_coroutine_threadsafe(self.elevenlabs.cancel(), self._loop)
        if not self.audio_in_queue:
            return
        while True:
            try:
                self.audio_in_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    def _open_output_stream(self, cfg: dict):
        output_device = resolve_output_device(
            cfg.get("speaker_device_name", ""),
            avoid_hint=cfg.get("mic_device_name", ""),
        )
        stream = sd.RawOutputStream(
            device=output_device,
            samplerate=RECEIVE_SAMPLE_RATE,
            channels=CHANNELS,
            dtype="int16",
            blocksize=CHUNK_SIZE,
        )
        stream.start()
        return stream

    def _play_chime(self):
        """Short two-note "I'm listening" tone right after the wake word, so the
        user knows to speak the command. Fire-and-forget on its own thread;
        any failure is swallowed (the agent works fine without it)."""
        cfg = load_api_config()
        if not cfg.get("audio_output_enabled", True) or not cfg.get("wake_chime", True):
            return

        def _run():
            try:
                rate = RECEIVE_SAMPLE_RATE
                gain = max(0.0, float(cfg.get("speaker_gain", 1.0)))
                t = np.arange(int(rate * 0.09)) / rate
                fade = np.minimum(1.0, np.minimum(t, t[::-1]) / 0.01)
                notes = [np.sin(2 * np.pi * f * t) * fade for f in (880.0, 1320.0)]
                wave = np.concatenate(notes) * 0.25 * gain
                pcm = (np.clip(wave, -1.0, 1.0) * 32767).astype(np.int16)
                device = resolve_output_device(
                    cfg.get("speaker_device_name", ""),
                    avoid_hint=cfg.get("mic_device_name", ""),
                )
                sd.play(pcm, samplerate=rate, device=device)
            except Exception as e:
                print(f"[Voice Agent] ⚠️ Wake chime failed: {e}")

        threading.Thread(target=_run, daemon=True).start()

    async def _play_audio(self):
        cfg = load_api_config()
        output_enabled = bool(cfg.get("audio_output_enabled", True))
        # Software volume boost on top of the OS/device volume (1.0 = off).
        gain = max(0.0, float(cfg.get("speaker_gain", 1.0)))
        stream = None
        if output_enabled:
            try:
                stream = self._open_output_stream(cfg)
                print("[Voice Agent] 🔊 Play started")
            except Exception as e:
                print(
                    f"[Voice Agent] ⚠️ Local playback unavailable ({e}). Continuing without spoken audio."
                )
        else:
            # The CMS/room audio system owns audible output: discard TTS
            # locally but keep draining the queue so it doesn't grow and the
            # speaking flag still resets.
            print(
                "[Voice Agent] 🔇 Local playback disabled (audio_output_enabled=false)"
                " — the room audio system handles audio out."
            )
        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(
                        self.audio_in_queue.get(), timeout=0.2
                    )
                except asyncio.TimeoutError:
                    # No audio for 200ms => playback has finished draining.
                    with self._speaking_lock:
                        was_speaking = self._is_speaking
                    if was_speaking:
                        # Wait for DAC / PortAudio hardware buffer and acoustic room reverb to decay
                        await asyncio.sleep(0.4)
                        self._clear_preroll()
                        self.set_speaking(False)
                    continue
                # First audio chunk received (from ElevenLabs) this exchange.
                self._timing.setdefault("first_audio_chunk_received", time.monotonic())
                if stream is None:
                    continue
                self.set_speaking(True)
                try:
                    # A hung write (observed in practice: PortAudio/WASAPI
                    # wedged after another process fought over the same
                    # output device — e.g. a previous, forcefully-killed
                    # instance) would otherwise block this coroutine forever.
                    # That's not just silence: mic-callback's standby
                    # transition and _idle_watchdog both refuse to act while
                    # set_speaking(True), so a stuck write here wedges the
                    # *whole* session open indefinitely, immune to the awake
                    # timeout, with no visible error. A timeout can't force
                    # the underlying OS-level write to actually stop (Python
                    # can't kill a thread), but abandoning it and dropping
                    # the stream at least lets the agent recover instead of
                    # hanging forever.
                    await asyncio.wait_for(
                        asyncio.to_thread(stream.write, apply_gain(chunk, gain)),
                        timeout=5.0,
                    )
                    # playback_started: audio actually starts this exchange —
                    # the last stage tracked, so print the breakdown right
                    # here, once, the first time audio actually plays.
                    if (
                        "wake_detected" in self._timing
                        and "playback_started" not in self._timing
                    ):
                        self._timing["playback_started"] = time.monotonic()
                        if os.getenv("TRAVIS_DEBUG_WAKE") == "1":
                            s = np.frombuffer(chunk, dtype=np.int16)
                            print(
                                f"[Voice Agent] 🔊 first reply chunk: {len(chunk)}B, "
                                f"peak={int(np.max(np.abs(s))) if s.size else 0}/32767, "
                                f"gain={gain}, stream active={stream.active}"
                            )
                        self._print_timing_report()
                except Exception as e:
                    # A local audio-driver hiccup (seen in practice: a transient
                    # Windows/PortAudio "no driver installed" error on write,
                    # unrelated to the mic/wake-word/Gemini pipeline) shouldn't
                    # tear down the whole session — degrade to silent for the
                    # rest of this connection rather than forcing a reconnect
                    # that drops the wake-word state and conversation context.
                    label = "timed out" if isinstance(e, asyncio.TimeoutError) else f"failed ({e})"
                    print(f"[Voice Agent] ⚠️ Playback write {label}. Continuing without spoken audio.")
                    try:
                        stream.stop()
                        stream.close()
                    except Exception:
                        pass
                    stream = None
                    self.set_speaking(False)
        finally:
            self.set_speaking(False)
            if stream is not None:
                stream.stop()
                stream.close()
