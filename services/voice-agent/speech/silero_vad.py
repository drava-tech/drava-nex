"""Silero VAD (MIT licence) on the ONNX runtime: speech probability for 32 ms frames of 16 kHz audio.

Uses the model file directly instead of the `silero-vad` pip package, which would pull in PyTorch.
The model is stateful: feed consecutive frames of one stream, and call reset() between streams.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

FRAME = 512  # samples per call at 16 kHz (32 ms)
_CONTEXT = 64  # the model wants the last 64 samples of the previous frame in front of each new one


class SileroVAD:
    def __init__(self, model_path: str | Path, sample_rate: int = 16000):
        if sample_rate != 16000:
            raise ValueError("Silero VAD is used at 16 kHz here")
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        self._session = ort.InferenceSession(str(model_path), sess_options=opts, providers=["CPUExecutionProvider"])
        self._sr = np.array(sample_rate, dtype=np.int64)
        self.reset()

    def reset(self) -> None:
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros((1, _CONTEXT), dtype=np.float32)

    def prob(self, frame: np.ndarray) -> float:
        """Speech probability (0..1) of one 512-sample int16 frame."""
        x = frame.astype(np.float32) / 32768.0
        x = np.concatenate([self._context, x[None, :]], axis=1)
        out, self._state = self._session.run(None, {"input": x, "state": self._state, "sr": self._sr})
        self._context = x[:, -_CONTEXT:]
        return float(out.reshape(-1)[0])
