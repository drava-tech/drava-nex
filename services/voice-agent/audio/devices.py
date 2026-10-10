"""Microphone/speaker device lookup and input gain."""

from __future__ import annotations


import numpy as np

# pyrefly: ignore [missing-import]
import sounddevice as sd

from settings import (
    RECEIVE_SAMPLE_RATE, SEND_SAMPLE_RATE,
)


class AudioDeviceMissing(RuntimeError):
    """A device named in the config isn't present (powered off / out of range /
    Bluetooth not connected). Raised only in strict mode — see the resolvers."""


# Tie-break only among entries whose rate already matches exactly. Without one, keep the first
# match: WASAPI rejects a non-native rate (-9997) where MME/DirectSound would resample.
# Same-named entries across Windows host APIs: WASAPI is the one that exposes the
# Bluetooth hands-free mic at its true 16 kHz; MME/DirectSound resample on top.
_HOST_API_RANK = {"Windows WASAPI": 0, "Windows DirectSound": 1, "MME": 2, "Windows WDM-KS": 3}


def _rank(dev) -> int:
    try:
        return _HOST_API_RANK.get(sd.query_hostapis(dev["hostapi"])["name"], 9)
    except Exception:
        return 9


def reinit_portaudio() -> None:
    """Re-read the OS device list. PortAudio snapshots it at import, so after a
    Bluetooth reconnect the old indices are stale and opens keep failing until it
    is re-initialised. Every stream must be closed first (agent/playback.py's
    `_reinit_audio` arranges that)."""
    sd._terminate()
    sd._initialize()


def resolve_input_device(name_hint: str, strict: bool = False):
    """Find an input device whose name contains name_hint (case-insensitive).

    Returns the sounddevice index, or None to use the OS default — including
    when the named device isn't present, so the agent still starts if the USB
    mic is unplugged. With strict=True a named-but-missing device raises
    AudioDeviceMissing instead: the agent must not quietly listen on the laptop
    mic when the room mic dropped off Bluetooth.

    The same device name commonly appears multiple times, once per Windows
    audio host API (MME, DirectSound, WASAPI...), often at DIFFERENT native
    sample rates — found live (2026-09-24) with a Bluetooth headset: MME and
    DirectSound both reported it at 44100Hz, WASAPI at 16000Hz (its real
    native rate). Opening it via the wrong entry forces PortAudio to
    resample 44100->16000 on every callback, which measurably degraded
    local ASR transcription quality despite sounding fine to the ear —
    prefer whichever match's default_samplerate equals SEND_SAMPLE_RATE, so
    the stream needs no resampling at all.
    """
    hint = (name_hint or "").strip().lower()
    if not hint:
        return None
    matches = [
        (idx, dev)
        for idx, dev in enumerate(sd.query_devices())
        if dev["max_input_channels"] > 0 and hint in dev["name"].lower()
    ]
    if not matches:
        if strict:
            raise AudioDeviceMissing(f"no input device matching '{name_hint}'")
        print(
            f"[Voice Agent] ⚠️ No input device matching '{name_hint}' — using default mic."
        )
        return None
    exact_rate = [
        (idx, dev)
        for idx, dev in matches
        if int(dev["default_samplerate"]) == SEND_SAMPLE_RATE
    ]
    idx, dev = sorted(exact_rate, key=lambda m: _rank(m[1]))[0] if exact_rate else matches[0]
    if not exact_rate:
        print(
            f"[Voice Agent] ⚠️ '{name_hint}' matched only at "
            f"{dev['default_samplerate']:.0f}Hz (need {SEND_SAMPLE_RATE}Hz) — "
            "PortAudio will resample; expect some quality loss."
        )
    print(f"[Voice Agent] 🎤 Input device: {dev['name']} (#{idx})")
    return idx


def chunk_rms(pcm: bytes) -> float:
    """RMS level (0..1) of an int16 PCM chunk."""
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    return float(np.sqrt(np.mean(samples * samples))) if samples.size else 0.0


def apply_gain(pcm: bytes, gain: float) -> bytes:
    """Scale int16 PCM by `gain`, clipping instead of wrapping around.

    Software volume for speakers that top out too quiet (a Bluetooth
    speakerphone in hands-free mode, for one)."""
    if gain == 1.0 or not pcm:
        return pcm
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) * gain
    return np.clip(samples, -32768, 32767).astype(np.int16).tobytes()


def resolve_output_device(name_hint: str, strict: bool = False):
    """Find an output device for TTS playback.

    With a name_hint, picks an output device containing it (case-
    insensitive) — preferring, among same-named entries across host APIs
    (MME/DirectSound/WASAPI/WDM-KS), one whose default_samplerate exactly
    matches RECEIVE_SAMPLE_RATE, then a clean integer multiple of it (cheap,
    clean resampling), then falling back to the first match — same class of
    silent-resampling quality loss resolve_input_device fixes for capture,
    found live with a Bluetooth headset. Without a name_hint, keeps the OS
    default. The speaker is chosen only by name (and `strict`): it may be the
    same physical device as the mic - a speakerphone does its echo
    cancellation in its own DSP and needs the reply to play through itself.
    With strict=True a named-but-missing speaker raises AudioDeviceMissing
    instead of falling back to the OS default.
    """
    hint = (name_hint or "").strip().lower()
    devices = sd.query_devices()
    if hint:
        matches = [
            (idx, dev)
            for idx, dev in enumerate(devices)
            if dev["max_output_channels"] > 0 and hint in dev["name"].lower()
        ]
        if matches:
            exact = [
                (i, d)
                for i, d in matches
                if int(d["default_samplerate"]) == RECEIVE_SAMPLE_RATE
            ]
            # No "prefer a clean multiple" tier here, unlike the input
            # resolver: found live that WASAPI entries can outright REJECT
            # opening a stream at a non-native rate ([PaErrorCode -9997])
            # rather than resampling, where MME/DirectSound tolerate it —
            # so a mismatched-but-"cleaner-ratio" WASAPI entry can be
            # strictly worse than the plain first match. Only trust a
            # same-named entry over the default first-match behavior when
            # its rate is an exact match (verified to actually open).
            idx, dev = sorted(exact, key=lambda m: _rank(m[1]))[0] if exact else matches[0]
            if not exact:
                print(
                    f"[Voice Agent] ⚠️ '{name_hint}' matched only at "
                    f"{dev['default_samplerate']:.0f}Hz (need "
                    f"{RECEIVE_SAMPLE_RATE}Hz) — PortAudio will resample."
                )
            print(f"[Voice Agent] 🔊 Output device: {dev['name']} (#{idx})")
            return idx
        if strict:
            raise AudioDeviceMissing(f"no output device matching '{name_hint}'")
        print(
            f"[Voice Agent] ⚠️ No output device matching '{name_hint}' — using default."
        )
    return None
