"""GPU (CUDA) target-speaker extraction — experimental, OFF by default.

Research spike (2026-09-22): can the RTX 4060 run a real source-separation
model fast enough, in short enough windows, to replace core/speaker.py's
CPU cosine-similarity gain gate with genuine target-speaker *extraction*
(removing the other voice's audio, not just attenuating it)?

There is no pip-installable pretrained checkpoint that is literally
"target-speaker-conditioned" and production-quality (BUTSpeechFIT's
SpeakerBeam ships no pretrained weights — train-from-scratch only; the only
public "real-time SpeakerBeam" reimplementation we found reports a negative
SI-SNR on its own test set, i.e. worse than doing nothing). What DOES exist,
is pip-installable, and is quality-verified is SpeechBrain's SepFormer
blind source-separation model (speechbrain/sepformer-wsj02mix, ~22.4dB
SI-SNRi on WSJ0-2mix). We turn that into target-speaker extraction the
standard way blind separation gets used for this: separate the window into
its N candidate sources, then pick whichever source's voice embedding
(reusing core.speaker's Resemblyzer encoder — no new embedding model needed)
best matches the enrolled target. This module owns exactly that: model
load + separate + select. It does NOT touch main.py's real-time send path;
see bench/gpu_extraction_bench.py for standalone latency/RTF numbers and
main.py's speaker_extraction_backend config flag for the (default-off)
live wiring.

Like core/speaker.py, this is fully optional: missing torch/speechbrain/CUDA,
or any load/inference failure, makes available() return False and every
other call return None — callers must fall back to the existing CPU gate.

Public API:
    available()                                  -> bool
    extract(mix_pcm, sample_rate, target_embed)   -> (pcm_bytes, elapsed_ms) | (None, elapsed_ms)
"""

from __future__ import annotations

import time

# pyrefly: ignore [missing-import]
import numpy as np

try:
    # pyrefly: ignore [missing-import]
    import torch

    # pyrefly: ignore [missing-import]
    from speechbrain.inference.separation import SepformerSeparation

    # pyrefly: ignore [missing-import]
    from speechbrain.utils.fetching import LocalStrategy
except Exception:
    torch = None
    SepformerSeparation = None
    LocalStrategy = None

from core import speaker  # Resemblyzer embed()/cosine() — reused, not reimplemented

_MODEL_SR = 8000  # speechbrain/sepformer-wsj02mix is trained at 8kHz
_NUM_SOURCES = 2  # wsj02mix separates into exactly 2 streams
# Windows shorter than this carry too little signal for the separator to
# find two distinct voices in, and for Resemblyzer to then judge between
# the two candidate outputs.
_MIN_SECONDS = 0.3

_model = None
_device = None
_use_fp16 = False
_load_failed = False


def _get_model():
    global _model, _device, _use_fp16, _load_failed
    if _model is not None:
        return _model
    if _load_failed or torch is None or SepformerSeparation is None:
        return None
    try:
        if not torch.cuda.is_available():
            print("[TargetSpeakerGPU] CUDA not available — GPU extraction disabled.")
            _load_failed = True
            return None
        _device = torch.device("cuda")
        gpu_name = torch.cuda.get_device_name(0)
        print(f"[TargetSpeakerGPU] CUDA available — using {gpu_name}.")
        _model = SepformerSeparation.from_hparams(
            source="speechbrain/sepformer-wsj02mix",
            savedir="core/.cache/sepformer-wsj02mix",
            run_opts={"device": "cuda:0"},
            # Windows default (SYMLINK) needs Developer Mode/admin
            # privilege to link the HF cache into savedir and hard-fails
            # without it; COPY just duplicates the ~100MB checkpoint once.
            local_strategy=LocalStrategy.COPY,
        )
        _model.eval()
        # FP16 halves memory/bandwidth and is usually a real speedup on
        # Ampere+/Ada GPUs (RTX 4060 is Ada) for conv-heavy nets like this.
        try:
            _model.mods.to(torch.float16)
            _use_fp16 = True
            print("[TargetSpeakerGPU] Running in FP16.")
        except Exception as exc:
            _use_fp16 = False
            print(f"[TargetSpeakerGPU] FP16 cast failed, staying FP32: {exc}")
        return _model
    except Exception as exc:
        print(f"[TargetSpeakerGPU] Model unavailable, GPU extraction off: {exc}")
        _load_failed = True
        return None


def available() -> bool:
    return _get_model() is not None


def _to_float_mono(pcm) -> np.ndarray | None:
    if pcm is None:
        return None
    if isinstance(pcm, (bytes, bytearray, memoryview)):
        if len(pcm) < 2:
            return None
        samples = np.frombuffer(bytes(pcm), dtype=np.int16)
    else:
        samples = np.asarray(pcm)
    if samples.size == 0:
        return None
    if samples.dtype == np.float32:
        return samples.reshape(-1)
    return (samples.astype(np.float32) / 32768.0).reshape(-1)


def extract(
    pcm, sample_rate: int, target_embedding
) -> tuple[bytes | None, float, float]:
    """Separate `pcm` into candidate sources and return whichever one best
    matches `target_embedding`, as int16 PCM at `sample_rate`, plus that
    match's cosine score and the wall-clock elapsed time in ms. Returns
    (None, 0.0, elapsed_ms) on any failure or when the window/target is
    unusable — callers treat a None pcm exactly like core.speaker.embed()'s
    None: "can't judge, don't gate"."""
    t0 = time.monotonic()
    model = _get_model()
    if model is None or target_embedding is None:
        return None, 0.0, (time.monotonic() - t0) * 1000

    wav = _to_float_mono(pcm)
    if wav is None or wav.size < int(_MIN_SECONDS * sample_rate):
        return None, 0.0, (time.monotonic() - t0) * 1000

    try:
        import librosa

        mix_8k = (
            librosa.resample(wav, orig_sr=sample_rate, target_sr=_MODEL_SR)
            if sample_rate != _MODEL_SR
            else wav
        )
        mix_t = torch.from_numpy(mix_8k).float().unsqueeze(0)  # [1, T]
        if _use_fp16:
            mix_t = mix_t.to(torch.float16)
        mix_t = mix_t.to(_device)

        with torch.inference_mode():
            # [1, T, num_sources]
            est_sources = model.separate_batch(mix_t)

        best_pcm = None
        best_score = -2.0
        for i in range(min(_NUM_SOURCES, est_sources.shape[-1])):
            cand = est_sources[0, :, i].detach().to(torch.float32).cpu().numpy()
            cand_16k = (
                librosa.resample(cand, orig_sr=_MODEL_SR, target_sr=sample_rate)
                if sample_rate != _MODEL_SR
                else cand
            )
            peak = float(np.max(np.abs(cand_16k))) or 1.0
            cand_pcm = (cand_16k / peak * 0.9 * 32767.0).astype(np.int16).tobytes()
            emb = speaker.embed(cand_pcm, sample_rate)
            if emb is None:
                continue
            score = speaker.cosine(emb, target_embedding)
            if score > best_score:
                best_score = score
                best_pcm = cand_pcm

        elapsed_ms = (time.monotonic() - t0) * 1000
        return best_pcm, max(best_score, 0.0), elapsed_ms
    except Exception as exc:
        print(f"[TargetSpeakerGPU] extract() failed: {exc}")
        return None, 0.0, (time.monotonic() - t0) * 1000
