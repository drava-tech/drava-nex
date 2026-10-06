"""Microphone/speaker device lookup and input gain."""

from __future__ import annotations


import numpy as np

# pyrefly: ignore [missing-import]
import sounddevice as sd

from settings import (
    RECEIVE_SAMPLE_RATE, SEND_SAMPLE_RATE,
)


def resolve_input_device(name_hint: str):
    """Find an input device whose name contains name_hint (case-insensitive).

    Returns the sounddevice index, or None to use the OS default — including
    when the named device isn't present, so the agent still starts if the USB
    mic is unplugged.

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
        print(
            f"[Voice Agent] ⚠️ No input device matching '{name_hint}' — using default mic."
        )
        return None
    exact_rate = [
        (idx, dev)
        for idx, dev in matches
        if int(dev["default_samplerate"]) == SEND_SAMPLE_RATE
    ]
    idx, dev = (exact_rate or matches)[0]
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


def resolve_output_device(name_hint: str, avoid_hint: str = ""):
    """Find an output device for TTS playback.

    With a name_hint, picks an output device containing it (case-
    insensitive) — preferring, among same-named entries across host APIs
    (MME/DirectSound/WASAPI/WDM-KS), one whose default_samplerate exactly
    matches RECEIVE_SAMPLE_RATE, then a clean integer multiple of it (cheap,
    clean resampling), then falling back to the first match — same class of
    silent-resampling quality loss resolve_input_device fixes for capture,
    found live with a Bluetooth headset. Without a name_hint, keeps the OS
    default — unless the default is the avoid_hint device (e.g. a USB
    speakerphone's own mic-adjacent speaker, which Windows tends to make
    default when plugged in), in which case the first other output device
    is used instead.
    """
    hint = (name_hint or "").strip().lower()
    avoid = (avoid_hint or "").strip().lower()
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
            idx, dev = (exact or matches)[0]
            if not exact:
                print(
                    f"[Voice Agent] ⚠️ '{name_hint}' matched only at "
                    f"{dev['default_samplerate']:.0f}Hz (need "
                    f"{RECEIVE_SAMPLE_RATE}Hz) — PortAudio will resample."
                )
            print(f"[Voice Agent] 🔊 Output device: {dev['name']} (#{idx})")
            return idx
        print(
            f"[Voice Agent] ⚠️ No output device matching '{name_hint}' — using default."
        )
    if avoid:
        try:
            default_out = sd.query_devices(kind="output")
        except Exception:
            default_out = None
        if default_out is not None and avoid in default_out["name"].lower():
            for idx, dev in enumerate(devices):
                name = dev["name"].lower()
                # Skip virtual devices that just forward to the OS default.
                if "sound mapper" in name or "primary sound" in name:
                    continue
                if dev["max_output_channels"] > 0 and avoid not in name:
                    print(
                        f"[Voice Agent] 🔊 Default output is the {avoid_hint} — "
                        f"using {dev['name']} (#{idx}) instead."
                    )
                    return idx
    return None
