"""Speaker playback: output stream, chime and the audio queue."""

from __future__ import annotations

import asyncio
import functools
import os
import time

import numpy as np

# pyrefly: ignore [missing-import]
import sounddevice as sd

from pathlib import Path

from settings import (
    CHANNELS, CHUNK_SIZE, RECEIVE_SAMPLE_RATE, load_api_config,
)
from agent.audio_cache import AudioCache
from audio.devices import apply_gain, reinit_portaudio, resolve_output_device

AUDIO_DIR = Path(__file__).resolve().parent.parent / "cache" / "tts"  # same folder as agent/canned_route.py


class _ChimeMarker:
    """Queued on `audio_in_queue` by the wake word: the playback loop writes the chime to the
    same output stream as the replies (one stream, one device), without marking Travis as
    speaking or touching the reply timing."""

    def __init__(self, name: str = "wake chime"):
        self.name = name

    def __repr__(self) -> str:
        return f"<{self.name}>"


CHIME = _ChimeMarker()
CUE = _ChimeMarker("follow-up cue")  # one soft note: "I am listening for your answer" (no wake word needed now)


@functools.lru_cache(maxsize=4)
def chime_pcm(rate: int) -> bytes:
    """Two short notes (880 Hz, 1320 Hz) as int16 mono PCM at `rate`, unscaled: the playback
    loop applies `speaker_gain` to everything it writes, chime included."""
    t = np.arange(int(rate * 0.09)) / rate
    fade = np.minimum(1.0, np.minimum(t, t[::-1]) / 0.01)
    notes = [np.sin(2 * np.pi * f * t) * fade for f in (880.0, 1320.0)]
    wave = np.concatenate(notes) * 0.25
    return (np.clip(wave, -1.0, 1.0) * 32767).astype(np.int16).tobytes()


@functools.lru_cache(maxsize=4)
def cue_pcm(rate: int) -> bytes:
    """One short, soft note (660 Hz) at `rate`: lower and quieter than the wake chime, so the two cannot be mixed up."""
    t = np.arange(int(rate * 0.11)) / rate
    fade = np.minimum(1.0, np.minimum(t, t[::-1]) / 0.015)
    return (np.clip(np.sin(2 * np.pi * 660.0 * t) * fade * 0.18, -1.0, 1.0) * 32767).astype(np.int16).tobytes()


def load_wake_ack(cfg: dict) -> bytes | None:
    """The wake acknowledgement ("Uh huh" by default, `wake_ack_text`; "" = keep the tone chime) in
    Travis's own ElevenLabs voice, as PCM at `RECEIVE_SAMPLE_RATE`. Rendered once (a few characters)
    and kept in the TTS audio cache, so every later wake word plays it from disk with no network.
    Blocking: call it from a thread. None = not available (no key, offline...) -> the chime plays."""
    text = str(cfg.get("wake_ack_text", "Uh huh") or "").strip()
    key = str(cfg.get("elevenlabs_api_key") or "").strip()
    voice = str(cfg.get("elevenlabs_voice_id") or "").strip()
    if not text or not key or not voice:
        return None
    model = str(cfg.get("elevenlabs_model_id") or "eleven_flash_v2_5").strip()
    cache = AudioCache(Path(cfg.get("tts_cache_dir") or AUDIO_DIR), voice, model, RECEIVE_SAMPLE_RATE)
    pcm = cache.load(text)
    if pcm is None:
        try:
            import requests

            r = requests.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
                params={"output_format": f"pcm_{RECEIVE_SAMPLE_RATE}"},
                headers={"xi-api-key": key, "content-type": "application/json"},
                json={"text": text, "model_id": model, "voice_settings": {"stability": 0.5, "similarity_boost": 0.8}},
                timeout=15,
            )
            r.raise_for_status()
            pcm = r.content
            if not pcm or len(pcm) % 2:
                return None
            cache.store(text, pcm)
        except Exception as e:  # noqa: BLE001
            print(f"[Voice Agent] ⚠️ Could not render the wake acknowledgement ({type(e).__name__}); using the chime.")
            return None
    return pcm


def _abort_and_close(stream) -> None:
    """Drop an output stream without waiting for pending audio. Blocking: call it from a thread
    (`stop()` on a wedged Bluetooth endpoint can hang)."""
    try:
        stream.abort()
    except Exception:
        pass
    try:
        stream.close()
    except Exception:
        pass


async def _drop_stream(stream) -> None:
    """Abort and close `stream` off the event loop; a driver that never answers is abandoned
    after a few seconds instead of freezing the agent."""
    try:
        await asyncio.wait_for(asyncio.to_thread(_abort_and_close, stream), timeout=3.0)
    except Exception:
        pass


class PlaybackMixin:
    """Speaker playback: output stream, chime and the audio queue."""

    _SPEAKER_RETRY_S = 2.0  # first wait before reopening a missing speaker; doubles up to 30 s

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

    @staticmethod
    def _speaker_strict(cfg: dict) -> bool:
        """A named speaker that is missing must not be replaced by the OS default
        (the laptop speakers) - the reply would play in the wrong place."""
        return bool(cfg.get("speaker_device_name")) and not cfg.get("audio_allow_default_fallback", False)

    def _open_output_stream(self, cfg: dict):
        output_device = resolve_output_device(
            cfg.get("speaker_device_name", ""),
            strict=self._speaker_strict(cfg),
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

    async def _reinit_audio(self):
        """Ask the playback task to close the speaker and re-read the OS device list.
        Called by the mic supervisor with its own stream already closed. If the playback
        task doesn't answer, PortAudio is left alone - terminating it under an open stream
        is worse than staying on the old device list."""
        self._audio_events["reinit"] = self._audio_events.get("reinit", 0) + 1
        print("[Voice Agent] 🔄 Re-reading the audio device list (Bluetooth reconnect?)")
        self._reinit_done.clear()
        self._reinit_requested = True
        try:
            await asyncio.wait_for(self._reinit_done.wait(), timeout=10.0)
        except asyncio.TimeoutError:
            self._reinit_requested = False
            print("[Voice Agent] ⚠️ Playback did not release the speaker in time — skipping the audio re-init.")

    def _play_chime(self):
        """Short two-note "I'm listening" tone right after the wake word, so the user knows to
        speak the command. It goes through the main playback queue and output stream (see
        `CHIME`), so it uses the same device as the replies. Called from the mic callback
        thread; any failure is swallowed (the agent works fine without it)."""
        try:
            cfg = load_api_config()
            if not cfg.get("audio_output_enabled", True) or not cfg.get("wake_chime", True):
                return
            loop, queue = self._loop, self.audio_in_queue
            if loop is None or queue is None or not loop.is_running():
                return
            loop.call_soon_threadsafe(queue.put_nowait, CHIME)
        except Exception as e:
            print(f"[Voice Agent] ⚠️ Wake chime failed: {e}")

    def _play_cue(self):
        """The follow-up cue (see `CUE`), from the mic callback thread. Swallows any failure like the wake chime."""
        try:
            cfg = load_api_config()
            if not cfg.get("audio_output_enabled", True) or not cfg.get("followup_cue", True):
                return
            loop, queue = self._loop, self.audio_in_queue
            if loop is None or queue is None or not loop.is_running():
                return
            loop.call_soon_threadsafe(queue.put_nowait, CUE)
        except Exception as e:
            print(f"[Voice Agent] ⚠️ Follow-up cue failed: {e}")

    async def _play_audio(self):
        cfg = load_api_config()
        output_enabled = bool(cfg.get("audio_output_enabled", True))
        # Software volume boost on top of the OS/device volume (1.0 = off).
        gain = max(0.0, float(cfg.get("speaker_gain", 1.0)))
        stream = None
        open_failures = 0
        next_open_at = 0.0  # monotonic time before which we don't retry opening the speaker
        ever_opened = False
        last_drop_note = 0.0
        wake_ack = None
        if output_enabled and cfg.get("wake_chime", True):
            try:
                wake_ack = await asyncio.to_thread(load_wake_ack, cfg)
            except Exception:
                wake_ack = None
        if not output_enabled:
            # The CMS/room audio system owns audible output: discard TTS
            # locally but keep draining the queue so it doesn't grow and the
            # speaking flag still resets.
            print(
                "[Voice Agent] 🔇 Local playback disabled (audio_output_enabled=false)"
                " — the room audio system handles audio out."
            )
        try:
            while True:
                # The mic supervisor wants PortAudio re-initialised (Bluetooth
                # reconnect): every stream must be closed first, and only this
                # coroutine owns the speaker stream.
                if self._reinit_requested:
                    if stream is not None:
                        await _drop_stream(stream)
                        stream = None
                    try:
                        await asyncio.to_thread(reinit_portaudio)
                    except Exception as e:
                        print(f"[Voice Agent] ⚠️ Audio re-init failed: {e}")
                    self.set_speaking(False)
                    open_failures, next_open_at = 0, 0.0
                    self._reinit_requested = False
                    self._reinit_done.set()
                if output_enabled and stream is None and time.monotonic() >= next_open_at:
                    try:
                        stream = self._open_output_stream(cfg)
                        print(
                            "[Voice Agent] 🔊 Play started" if not ever_opened and not open_failures
                            else "[Voice Agent] 🔊 Speaker is back — playback resumed"
                        )
                        ever_opened = True
                        open_failures = 0
                    except Exception as e:
                        open_failures += 1
                        next_open_at = time.monotonic() + min(self._SPEAKER_RETRY_S * 2 ** (open_failures - 1), 30.0)
                        self._audio_events["speaker_open_failed"] = self._audio_events.get("speaker_open_failed", 0) + 1
                        if open_failures in (1, 5) or open_failures % 10 == 0:
                            print(
                                f"[Voice Agent] ⚠️ Speaker unavailable ({e}). Travis is silent until it is back; "
                                "retrying."
                            )
                        if open_failures == 3:
                            # Re-reading the device list needs the mic stream closed too.
                            self._audio_reset_wanted = True
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
                is_chime = isinstance(chunk, _ChimeMarker)
                if not is_chime and getattr(self, "_drop_tts_audio", False):
                    self._stale_chunks_dropped = getattr(self, "_stale_chunks_dropped", 0) + 1
                    continue  # audio of a reply a new wake word replaced (agent/local.py _barge_in)
                if is_chime:
                    if chunk is CHIME and wake_ack:
                        chunk = wake_ack
                    else:
                        chunk = (cue_pcm if chunk is CUE else chime_pcm)(RECEIVE_SAMPLE_RATE)
                else:
                    # First audio chunk received (from ElevenLabs) this exchange.
                    self._timing.setdefault("first_audio_chunk_received", time.monotonic())
                if stream is None:
                    if not is_chime and output_enabled and time.monotonic() - last_drop_note > 10.0:
                        last_drop_note = time.monotonic()
                        print("[Voice Agent] ⚠️ A reply was dropped — the speaker is not available.")
                    continue
                if not is_chime:
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
                        not is_chime
                        and "wake_detected" in self._timing
                        and "playback_started" not in self._timing
                    ):
                        self._timing["playback_started"] = time.monotonic()
                        if os.getenv("TRAVIS_DEBUG_WAKE") == "1":
                            s = np.frombuffer(chunk, dtype=np.int16)
                            boosted = np.abs(s.astype(np.float32) * gain)
                            print(
                                f"[Voice Agent] 🔊 first reply chunk: {len(chunk)}B, "
                                f"peak={int(np.max(np.abs(s))) if s.size else 0}/32767, "
                                f"gain={gain} (clips {int(np.count_nonzero(boosted > 32767))} samples), "
                                f"stream active={stream.active}"
                            )
                        self._print_timing_report()
                except Exception as e:
                    # A local audio-driver hiccup (a transient Windows/PortAudio
                    # error on write, or a Bluetooth link that dropped) must not
                    # tear down the session: drop this stream (off the event loop,
                    # since a wedged driver can block on close) and let the loop
                    # reopen the speaker, with the same back-off as a missing one.
                    label = "timed out" if isinstance(e, asyncio.TimeoutError) else f"failed ({e})"
                    print(f"[Voice Agent] ⚠️ Playback write {label}. Reopening the speaker.")
                    await _drop_stream(stream)
                    stream = None
                    next_open_at = time.monotonic() + min(1.0, self._SPEAKER_RETRY_S)
                    self._audio_events["speaker_write_failed"] = self._audio_events.get("speaker_write_failed", 0) + 1
                    self.set_speaking(False)
        finally:
            self.set_speaking(False)
            if stream is not None:
                stream.stop()
                stream.close()
