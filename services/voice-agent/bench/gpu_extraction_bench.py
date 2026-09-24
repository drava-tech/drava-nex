"""Standalone benchmark for core/target_speaker_gpu.py — NOT part of the
unittest suite (needs torch+CUDA+speechbrain+a GPU; the regular test suite
must keep passing on a machine without any of that). Run directly:

    .venv/Scripts/python.exe bench/gpu_extraction_bench.py

Measures, on synthetic audio (see NOTE below): CUDA availability + GPU name,
per-chunk GPU extraction latency, real-time factor (RTF), GPU utilization
during a run, and the same numbers for the existing CPU Resemblyzer gate for
a direct before/after comparison. This is a feasibility/latency spike, not a
perceptual-quality evaluation — see the printed caveat.
"""

from __future__ import annotations

import statistics
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402

SR = 16000


def _synthetic_voice(freq_base: float, seconds: float, seed: int) -> np.ndarray:
    """A crude speech-like stand-in: a fundamental + harmonics with slow
    amplitude/pitch modulation, NOT a real recorded voice. Good enough to
    exercise the tensor pipeline and measure latency/RTF; NOT good enough to
    judge separation quality against a real second speaker — that needs two
    actual human voices talking over each other, which this benchmark can't
    produce."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * SR), dtype=np.float32) / SR
    vibrato = 1.0 + 0.02 * np.sin(2 * np.pi * 4.5 * t)
    sig = np.zeros_like(t)
    for h, amp in enumerate([1.0, 0.5, 0.3, 0.15], start=1):
        sig += amp * np.sin(2 * np.pi * freq_base * h * vibrato * t)
    envelope = 0.6 + 0.4 * np.sin(2 * np.pi * 2.0 * t + rng.uniform(0, 3))
    sig *= envelope
    sig += rng.normal(0, 0.01, size=sig.shape)  # mic-noise floor
    sig /= np.max(np.abs(sig)) + 1e-8
    return (sig * 0.8).astype(np.float32)


def _to_pcm16(x: np.ndarray) -> bytes:
    return (np.clip(x, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()


def _si_sdr(estimate: np.ndarray, reference: np.ndarray) -> float:
    """Scale-invariant SDR (dB) of `estimate` against the known-clean
    `reference`: how much of the estimate is "target signal, any gain"
    versus everything else (bystander + distortion). This is the actual
    question — can the target voice be recovered from the window — not
    latency. Higher is better; roughly 0dB = as much target as noise,
    negative = mostly not-target."""
    n = min(len(estimate), len(reference))
    estimate = estimate[:n].astype(np.float64)
    reference = reference[:n].astype(np.float64)
    estimate = estimate - np.mean(estimate)
    reference = reference - np.mean(reference)
    alpha = np.dot(estimate, reference) / (np.dot(reference, reference) + 1e-8)
    target = alpha * reference
    noise = estimate - target
    return float(
        10 * np.log10((np.sum(target**2) + 1e-8) / (np.sum(noise**2) + 1e-8))
    )


def _gpu_util_sample() -> str:
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return out.stdout.strip()
    except Exception as exc:
        return f"(nvidia-smi unavailable: {exc})"


def _report(label: str, latencies_ms: list[float], window_sec: float):
    if not latencies_ms:
        print(f"{label}: no samples")
        return
    mean_ms = statistics.mean(latencies_ms)
    p95_ms = sorted(latencies_ms)[int(0.95 * (len(latencies_ms) - 1))]
    rtf = (mean_ms / 1000.0) / window_sec
    print(
        f"{label}: n={len(latencies_ms)} mean={mean_ms:.1f}ms "
        f"p95={p95_ms:.1f}ms min={min(latencies_ms):.1f}ms "
        f"max={max(latencies_ms):.1f}ms RTF={rtf:.3f} "
        f"({'faster than real-time' if rtf < 1.0 else 'SLOWER than real-time'})"
    )


def main():
    print("=" * 70)
    print("GPU target-speaker extraction — feasibility/latency benchmark")
    print("=" * 70)

    import torch

    cuda_ok = torch.cuda.is_available()
    print(f"torch.cuda.is_available(): {cuda_ok}")
    if cuda_ok:
        print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"nvidia-smi (idle): {_gpu_util_sample()}")
    print()

    # Enrollment: "audio containing Travis" stand-in — a short clip of
    # speaker A alone, exactly like main.py's _enroll_target() uses the
    # wake-word audio as the reference.
    from core import speaker

    enroll = _synthetic_voice(140.0, 1.0, seed=1)  # speaker A, lower pitch
    target_embedding = speaker.embed(_to_pcm16(enroll), SR, min_rms=0.0)
    if target_embedding is None:
        print("FATAL: could not embed the synthetic enrollment clip.")
        return

    speaker_a = _synthetic_voice(140.0, 6.0, seed=2)
    speaker_b = _synthetic_voice(230.0, 6.0, seed=3)  # bystander, higher pitch
    mixture = (speaker_a + speaker_b) * 0.5

    for window_sec, hop_sec in [(0.3, 0.15), (0.45, 0.225)]:
        window_samples = int(window_sec * SR)
        hop_samples = int(hop_sec * SR)

        print(f"\n--- window={window_sec * 1000:.0f}ms hop={hop_sec * 1000:.0f}ms ---")

        # Baseline: current production path — CPU Resemblyzer embed+cosine
        # on the raw (still-mixed) window. This is what ships today.
        cpu_latencies = []
        pos = 0
        while pos + window_samples <= len(mixture):
            chunk = mixture[pos : pos + window_samples]
            t0 = time.monotonic()
            emb = speaker.embed(_to_pcm16(chunk), SR, min_rms=0.0)
            if emb is not None:
                speaker.cosine(emb, target_embedding)
            cpu_latencies.append((time.monotonic() - t0) * 1000)
            pos += hop_samples
        _report("CPU Resemblyzer gate (current, production)", cpu_latencies, window_sec)

        # Candidate: GPU SepFormer separation + embedding-based selection.
        from core import target_speaker_gpu

        if not target_speaker_gpu.available():
            print("GPU extraction: unavailable (see load errors above) — skipping.")
            continue

        gpu_latencies = []
        util_samples = []
        pos = 0
        i = 0
        while pos + window_samples <= len(mixture):
            chunk = mixture[pos : pos + window_samples]
            _, _, elapsed_ms = target_speaker_gpu.extract(
                _to_pcm16(chunk), SR, target_embedding
            )
            gpu_latencies.append(elapsed_ms)
            if i % 5 == 0:
                util_samples.append(_gpu_util_sample())
            pos += hop_samples
            i += 1
        _report("GPU SepFormer extraction (candidate)", gpu_latencies, window_sec)
        print("GPU utilization samples during run:")
        for s in util_samples[:5]:
            print(f"  {s}")

    # ── Separation quality: can the target actually be recovered from a
    # window where both voices are speaking AT THE SAME TIME? ──────────────
    # This is the capability question, not the latency question. The gain
    # gate (Resemblyzer path) never touches window *content* — it only
    # scales loudness — so its SI-SDR against the clean target is
    # mathematically identical to the raw mixture's, whatever gain it picks.
    # If SepFormer is doing real separation, its output should score higher.
    print("\n" + "=" * 70)
    print("Separation quality on genuinely overlapping audio (SI-SDR vs clean target)")
    print("=" * 70)

    # Sanity bounds on the metric itself, so the numbers below are readable
    # against something: a perfect match and a pure negative control.
    perfect = _si_sdr(speaker_a[:SR], speaker_a[:SR])
    negative_control = _si_sdr(speaker_b[:SR], speaker_a[:SR])
    print(f"(sanity) target vs itself:      {perfect:+.1f} dB  (should be very high)")
    print(f"(sanity) other speaker vs target: {negative_control:+.1f} dB  (should be low/negative)")

    window_sec, hop_sec = 0.45, 0.225  # the configured production setting
    window_samples = int(window_sec * SR)
    hop_samples = int(hop_sec * SR)

    from core import speaker, target_speaker_gpu

    mix_sdrs, gpu_sdrs = [], []
    pos = 0
    while pos + window_samples <= len(mixture):
        mix_chunk = mixture[pos : pos + window_samples]
        clean_chunk = speaker_a[pos : pos + window_samples]

        mix_sdrs.append(_si_sdr(mix_chunk, clean_chunk))

        if target_speaker_gpu.available():
            gpu_pcm, _, _ = target_speaker_gpu.extract(
                _to_pcm16(mix_chunk), SR, target_embedding
            )
            if gpu_pcm is not None:
                gpu_wav = (
                    np.frombuffer(gpu_pcm, dtype=np.int16).astype(np.float32)
                    / 32768.0
                )
                gpu_sdrs.append(_si_sdr(gpu_wav, clean_chunk))
        pos += hop_samples

    print(
        f"\nRaw mixture (= what the Resemblyzer gain gate forwards, content "
        f"unchanged): mean SI-SDR = {statistics.mean(mix_sdrs):+.1f} dB "
        f"over {len(mix_sdrs)} windows"
    )
    if gpu_sdrs:
        print(
            f"GPU SepFormer extracted output: mean SI-SDR = "
            f"{statistics.mean(gpu_sdrs):+.1f} dB over {len(gpu_sdrs)} windows"
        )
        print(
            f"Improvement: {statistics.mean(gpu_sdrs) - statistics.mean(mix_sdrs):+.1f} dB"
        )
    else:
        print("GPU SepFormer: no usable windows (extraction failed every time).")

    print("\n" + "=" * 70)
    print(
        "CAVEAT: mixture audio above is synthetic (harmonic tones with "
        "modulation), not two real people talking over each other. It "
        "exercises the real tensor/model/GPU pipeline and gives honest "
        "latency/RTF/SI-SDR numbers on genuinely simultaneous synthetic "
        "voices, but real speech has formant structure and prosody these "
        "tones don't — the DIRECTION of the result (does separation help "
        "at all) is informative, the exact dB numbers are not directly "
        "transferable to real speech. A live two-person mic test is the "
        "next real validation step."
    )
    print("=" * 70)


if __name__ == "__main__":
    main()
