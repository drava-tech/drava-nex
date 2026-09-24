"""One-off probe (not wired into anything): does swapping SepFormer for the
much smaller Conv-TasNet (asteroid, ~5M params, no attention) recover
latency while keeping genuine separation of overlapping audio? Reuses
gpu_extraction_bench.py's synthetic two-speaker mixture and SI-SDR metric.
"""

from __future__ import annotations

import functools
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
import torch  # noqa: E402

from bench.gpu_extraction_bench import _si_sdr, _synthetic_voice, _to_pcm16  # noqa: E402
from core import speaker  # noqa: E402

SR = 16000
MODEL_SR = 8000


def main():
    _orig_load = torch.load
    torch.load = functools.partial(_orig_load, weights_only=False)
    from asteroid.models import ConvTasNet

    model = ConvTasNet.from_pretrained("JorisCos/ConvTasNet_Libri2Mix_sepclean_8k")
    torch.load = _orig_load
    model = model.cuda().eval()
    # asteroid's ConvTasNet mixes a plain nn.PReLU (float32 weight) into the
    # masker; a blanket .half() leaves that buffer float32 and PReLU refuses
    # to type-promote, so this specific architecture doesn't get the FP16
    # win SepFormer did — noted as a finding, not chased further here.
    model_fp16 = model
    use_fp16 = False
    print(f"Conv-TasNet loaded: {sum(p.numel() for p in model.parameters())} params, FP16={use_fp16}")

    import librosa

    enroll = _synthetic_voice(140.0, 1.0, seed=1)
    target_embedding = speaker.embed(_to_pcm16(enroll), SR, min_rms=0.0)

    speaker_a = _synthetic_voice(140.0, 6.0, seed=2)
    speaker_b = _synthetic_voice(230.0, 6.0, seed=3)
    mixture = (speaker_a + speaker_b) * 0.5

    window_sec, hop_sec = 0.45, 0.225
    window_samples = int(window_sec * SR)
    hop_samples = int(hop_sec * SR)

    latencies = []
    sdrs = []
    pos = 0
    while pos + window_samples <= len(mixture):
        mix_chunk = mixture[pos : pos + window_samples]
        clean_chunk = speaker_a[pos : pos + window_samples]

        t0 = time.monotonic()
        mix_8k = librosa.resample(mix_chunk, orig_sr=SR, target_sr=MODEL_SR)
        mix_t = torch.from_numpy(mix_8k).float().unsqueeze(0).cuda()
        if use_fp16:
            mix_t = mix_t.half()
        with torch.inference_mode():
            est = model_fp16(mix_t)  # [1, n_src, T]

        best_pcm, best_score, best_wav = None, -2.0, None
        for i in range(est.shape[1]):
            cand = est[0, i].detach().float().cpu().numpy()
            cand_16k = librosa.resample(cand, orig_sr=MODEL_SR, target_sr=SR)
            peak = float(np.max(np.abs(cand_16k))) or 1.0
            cand_pcm = (cand_16k / peak * 0.9 * 32767.0).astype(np.int16).tobytes()
            emb = speaker.embed(cand_pcm, SR, min_rms=0.0)
            if emb is None:
                continue
            score = speaker.cosine(emb, target_embedding)
            if score > best_score:
                best_score = score
                best_pcm = cand_pcm
                best_wav = cand_16k
        latencies.append((time.monotonic() - t0) * 1000)

        if best_pcm is not None:
            sdrs.append(_si_sdr(best_wav, clean_chunk))

        pos += hop_samples

    mean_ms = statistics.mean(latencies)
    p95_ms = sorted(latencies)[int(0.95 * (len(latencies) - 1))]
    print(
        f"Conv-TasNet @ {window_sec*1000:.0f}ms window: n={len(latencies)} "
        f"mean={mean_ms:.1f}ms p95={p95_ms:.1f}ms min={min(latencies):.1f}ms "
        f"max={max(latencies):.1f}ms RTF={(mean_ms/1000)/window_sec:.3f}"
    )
    print(f"Conv-TasNet mean SI-SDR vs clean target: {statistics.mean(sdrs):+.1f} dB over {len(sdrs)} windows")
    print("(compare: SepFormer was mean=107.2ms p95=170.7ms, SI-SDR=+2.2dB; raw mixture SI-SDR=-0.1dB)")


if __name__ == "__main__":
    main()
