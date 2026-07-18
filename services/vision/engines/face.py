"""
engine.py — insightface wrapper: SCRFD face detection + ArcFace 512-d embedding.

One detect() call runs both models on the GPU and returns every face in the
frame with its bbox, detection score and normalized embedding. The min-size
filter is applied by the caller (pipeline) so this module stays a pure
model wrapper.
"""

from __future__ import annotations
import logging
import os
import sys
from typing import Any

import numpy as np

from ..config import Config

log = logging.getLogger(__name__)


_CUDA_WHEEL_PACKAGES = (
    "nvidia.cuda_runtime",
    "nvidia.cublas",
    "nvidia.cudnn",
    "nvidia.cufft",
    "nvidia.curand",
    "nvidia.cusolver",
    "nvidia.cusparse",
    "nvidia.nvjitlink",
)


def _register_cuda_dll_dirs() -> None:
    """
    Make the pip-installed CUDA/cuDNN wheels discoverable by onnxruntime-gpu on
    Windows. These wheels drop their DLLs under site-packages/nvidia/<pkg>/bin,
    which is not on the default DLL search path, so without this the CUDA
    execution provider silently fails to load (LoadLibrary error 126) and
    onnxruntime falls back to CPU. onnxruntime's own provider loader doesn't
    honor os.add_dll_directory() for this, so these dirs are prepended to PATH
    instead (the mechanism ONNX Runtime's docs actually recommend). No-op if
    the packages aren't installed (e.g. a Linux host using system CUDA).
    """
    if sys.platform != "win32":
        return
    bin_dirs = []
    for pkg in _CUDA_WHEEL_PACKAGES:
        try:
            mod = __import__(pkg, fromlist=["_"])
            bin_dirs.append(f"{next(iter(mod.__path__))}\\bin")
        except (ImportError, StopIteration, FileNotFoundError):
            pass
    if bin_dirs:
        os.environ["PATH"] = os.pathsep.join(bin_dirs) + os.pathsep + os.environ["PATH"]


class FaceEngine:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._app = None

    def load(self) -> None:
        _register_cuda_dll_dirs()
        import onnxruntime as ort
        from insightface.app import FaceAnalysis

        available = ort.get_available_providers()
        if "CUDAExecutionProvider" not in available:
            raise RuntimeError(
                f"CUDAExecutionProvider not available (got {available}). "
                "GPU is required — check the onnxruntime-gpu / CUDA / cuDNN install."
            )

        log.info(
            "[engine] Loading insightface pack '%s' (root=%s)…",
            self._cfg.model_pack,
            self._cfg.model_root,
        )
        app = FaceAnalysis(
            name=self._cfg.model_pack,
            root=self._cfg.model_root,
            allowed_modules=["detection", "recognition"],
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        app.prepare(
            ctx_id=0,
            det_size=(self._cfg.det_size, self._cfg.det_size),
            det_thresh=self._cfg.det_score_threshold,
        )

        # Warm up: the first CUDA run compiles kernels and is 10-100x slower.
        dummy = np.zeros((self._cfg.det_size, self._cfg.det_size, 3), dtype=np.uint8)
        for _ in range(3):
            app.get(dummy)

        self._app = app
        log.info("[engine] Model loaded and warmed up (det_size=%d).", self._cfg.det_size)

    def detect(self, frame_bgr: np.ndarray) -> list[Any]:
        """
        Return insightface Face objects for every face in the frame.
        Each has .bbox (x1,y1,x2,y2 float array), .det_score and
        .normed_embedding (unit-norm float32[512]).
        """
        if self._app is None:
            raise RuntimeError("FaceEngine.load() must be called first.")
        return self._app.get(frame_bgr)
