"""Optional target-speaker verification for TRAVIS.

Like core.expression and core.camera, this module is intentionally independent
of any feature and is *fully optional*. Its job is to turn a short chunk of
microphone PCM into a fixed-length voice embedding so the main loop can tell
whether the person speaking right now is the same person who woke TRAVIS — and
drop ambient chatter from bystanders while awake.

If the backend or its dependencies are missing, available() returns False and
every other call returns None. Callers must treat that as "no gating" and fall
back to today's always-forward behavior, so TRAVIS never goes deaf just because
the speaker model isn't installed.

Backend: Resemblyzer (GE2E d-vector speaker encoder, 256-dim). It is optional —
install with `pip install resemblyzer` (pulls in torch). We keep the encoder
behind a lazy, cached loader exactly like expression.py caches its ONNX session.

Public API:
    available()               -> bool
    embed(pcm, sample_rate)   -> np.ndarray | None   (L2-normalized d-vector)
    cosine(a, b)              -> float
"""

from __future__ import annotations

import os

# pyrefly: ignore [missing-import]
import numpy as np

try:
    # pyrefly: ignore [missing-import]
    from resemblyzer import VoiceEncoder

    # pyrefly: ignore [missing-import]
    from resemblyzer.audio import normalize_volume, audio_norm_target_dBFS

    # pyrefly: ignore [missing-import]
    import librosa
except Exception:  # ImportError, or torch / backend load failure
    VoiceEncoder = None
    normalize_volume = None
    audio_norm_target_dBFS = None
    librosa = None


# The encoder's native sample rate. Resemblyzer resamples to this internally via
# preprocess_wav, but we keep it here for the minimum-length guard below.
_TARGET_SR = 16000
# Segments shorter than this (after we have raw samples) carry too little voice
# to embed reliably; skip them so we don't enroll or judge on noise.
_MIN_SECONDS = 0.4

_encoder = None  # cached VoiceEncoder
_load_failed = False  # don't retry a known-bad load on every call


def _get_encoder():
    """Lazily build and cache the voice encoder, or None if unavailable."""
    global _encoder, _load_failed
    if _encoder is not None:
        return _encoder
    if _load_failed or VoiceEncoder is None:
        return None
    try:
        # device="cpu" keeps this off any GPU and matches the CPU-only stack the
        # rest of TRAVIS uses (onnxruntime CPUExecutionProvider, etc.).
        _encoder = VoiceEncoder(device="cpu", verbose=False)
        return _encoder
    except Exception as exc:
        print(f"[Speaker] Voice encoder unavailable, speaker gating off: {exc}")
        _load_failed = True
        return None


def available() -> bool:
    return _get_encoder() is not None


def _to_float_mono(pcm) -> np.ndarray | None:
    """Coerce int16 PCM (bytes or ndarray) to float32 mono in [-1, 1]."""
    if pcm is None:
        return None
    if isinstance(pcm, (bytes, bytearray, memoryview)):
        if len(pcm) < 2:
            return None
        samples = np.frombuffer(bytes(pcm), dtype=np.int16)
    else:
        samples = np.asarray(pcm)
        if samples.dtype != np.int16 and samples.dtype != np.float32:
            samples = samples.astype(np.int16)
    if samples.size == 0:
        return None
    if samples.dtype == np.float32:
        return samples.reshape(-1)
    return (samples.astype(np.float32) / 32768.0).reshape(-1)


def embed(
    pcm, sample_rate: int = _TARGET_SR, min_rms: float = 0.015
) -> np.ndarray | None:
    """Return an L2-normalized voice embedding for a chunk of PCM, or None.

    `pcm` may be int16 bytes (as delivered by sounddevice) or a numpy array.
    Returns None when the encoder is unavailable, the chunk is too short, or
    inference fails — callers treat None as "can't judge, don't gate".

    `min_rms` used to be a hardcoded 0.015 (-36 dBFS): speech typically clears
    it, silence/room noise doesn't. Made a parameter (main.py wires it to
    `speaker_min_rms` in config) after this floor being too high for a quieter
    mic silently defeated the whole gate — every segment came back None, so
    _target_embed was never set and everything just passed through unfiltered
    (2026-09-22). Callers should pass the actual configured value."""
    enc = _get_encoder()
    if enc is None:
        return None

    wav = _to_float_mono(pcm)
    if wav is None or wav.size < int(_MIN_SECONDS * sample_rate):
        return None

    # ponytail: silence / ambient noise guard — never extract voice embeddings from noise.
    rms = float(np.sqrt(np.mean(wav**2)))
    if rms < min_rms:
        if os.getenv("TRAVIS_DEBUG_WAKE") == "1":
            print(f"[Speaker] rejected: rms={rms:.4f} < min_rms={min_rms:.4f}")
        return None
    if os.getenv("TRAVIS_DEBUG_WAKE") == "1":
        print(f"[Speaker] rms={rms:.4f} (min_rms={min_rms:.4f}) — embedding")

    try:
        # Replicates resemblyzer's own preprocess_wav (resample + normalize)
        # minus its VAD silence-trimming step, called out here rather than
        # through that function directly: newer resemblyzer (0.1.4) made
        # trimming unconditional with no opt-out, and our segments are only
        # ~0.7s — trimming could eat the whole window and starve every
        # embedding, silently defeating the gate instead of just being a
        # cosmetic difference.
        proc = (
            librosa.resample(wav, orig_sr=sample_rate, target_sr=_TARGET_SR)
            if sample_rate != _TARGET_SR
            else wav
        )
        proc = normalize_volume(proc, audio_norm_target_dBFS, increase_only=True)
        if proc.size < int(_MIN_SECONDS * _TARGET_SR):
            return None
        # return_partials=False (the installed version's default) embeds the
        # whole (short) window as one frame instead of averaging 1.6s
        # partials that would just pad our audio. The kwarg name changed
        # from the older `using_partials` this code was originally written
        # against; passing the current name explicitly rather than relying
        # on the default so this doesn't silently break again on a future
        # resemblyzer upgrade.
        vec = enc.embed_utterance(proc, return_partials=False)
    except Exception as exc:
        print(f"[Speaker] Embedding failed: {exc}")
        return None

    vec = np.asarray(vec, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vec))
    if norm == 0.0:
        return None
    return vec / norm


def blend(target, new, weight: float = 0.1) -> np.ndarray:
    """Nudge the enrolled embedding toward a freshly confirmed one and
    re-normalize, so the target voice adapts slowly over a conversation."""
    target = np.asarray(target, dtype=np.float32).reshape(-1)
    new = np.asarray(new, dtype=np.float32).reshape(-1)
    mixed = (1.0 - weight) * target + weight * new
    norm = float(np.linalg.norm(mixed))
    if norm == 0.0:
        return target
    return mixed / norm


def cosine(a, b) -> float:
    """Cosine similarity of two vectors. Robust to non-normalized inputs."""
    if a is None or b is None:
        return 0.0
    a = np.asarray(a, dtype=np.float32).reshape(-1)
    b = np.asarray(b, dtype=np.float32).reshape(-1)
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))
