"""Pipecat Smart Turn v3.2 (BSD-2-Clause): does this audio sound like a finished turn?

An audio-native end-of-turn model (Whisper-tiny encoder + a linear head, 8 MB int8 ONNX on the CPU). It is given the last
<= 8 s of 16 kHz mono audio, zero-padded at the START to 8 s, with the waveform normalised to zero mean / unit variance and
turned into Whisper log-mel features, exactly as pipecat's own LocalSmartTurnAnalyzerV3 does. It returns a probability that
the speaker has finished (the reference code calls > 0.5 "complete").

The log-mel step reuses faster-whisper's numpy feature extractor (same algorithm as Whisper's), so no `transformers` is needed.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

_RATE = 16000
_SECONDS = 8
_SAMPLES = _RATE * _SECONDS


class SmartTurn:
    def __init__(self, model_path: str | Path):
        import onnxruntime as ort
        from faster_whisper.feature_extractor import FeatureExtractor

        opts = ort.SessionOptions()
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self._session = ort.InferenceSession(str(model_path), sess_options=opts, providers=["CPUExecutionProvider"])
        self._features = FeatureExtractor(feature_size=80, sampling_rate=_RATE, hop_length=160, chunk_length=_SECONDS, n_fft=400)

    def prob(self, audio: np.ndarray) -> float:
        """Probability that the speech in `audio` (int16, 16 kHz, mono) is a finished turn."""
        x = audio.astype(np.float32) / 32768.0
        x = x[-_SAMPLES:]
        if len(x) < _SAMPLES:
            x = np.pad(x, (_SAMPLES - len(x), 0))
        x = (x - x.mean()) / np.sqrt(x.var() + 1e-7)
        feats = self._features(x.astype(np.float32), padding=0)  # (80, 800)
        out = self._session.run(None, {"input_features": feats[None].astype(np.float32)})
        return float(np.asarray(out[0]).reshape(-1)[0])
