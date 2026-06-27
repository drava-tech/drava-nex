"""
detector.py — YOLOv8 inference wrapper for the Product Vision service.

Uses Ultralytics YOLO (https://github.com/ultralytics/ultralytics, AGPL-3.0).
Loads a trained .pt model file and runs single-frame inference, returning
the highest-confidence detection whose label matches a known product.

Usage:
    detector = Detector(config)
    detector.load()
    result = detector.detect(frame)   # frame is a numpy BGR array
    # result.label is None if nothing was detected above threshold
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import numpy as np

from config import Config

log = logging.getLogger(__name__)


@dataclass
class Detection:
    """A single detection result from one inference pass."""
    label: str           # YOLO class name, matches the CMS detectionLabel field
    confidence: float    # 0.0 – 1.0
    bbox: tuple[int, int, int, int]  # (x1, y1, x2, y2) in pixels


class Detector:
    """
    Wraps a trained YOLOv8 model for product detection.

    The model path is set via VISION_MODEL_PATH in .env.
    Call load() once at startup; detect() is safe to call in a tight loop.
    """

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._model = None

    def load(self) -> None:
        """Load the YOLO model from disk. Raises FileNotFoundError if missing."""
        from ultralytics import YOLO  # type: ignore

        log.info("[detector] Loading model from %s", self._cfg.model_path)
        self._model = YOLO(self._cfg.model_path)
        log.info("[detector] Model loaded — classes: %s", list(self._model.names.values()))

    def detect(self, frame: np.ndarray) -> Optional[Detection]:
        """
        Run inference on a single BGR frame.

        Returns the highest-confidence Detection above the confidence threshold,
        or None if nothing qualifies.
        """
        if self._model is None:
            raise RuntimeError("[detector] Model is not loaded. Call load() first.")

        results = self._model.predict(
            source=frame,
            conf=self._cfg.confidence_threshold,
            verbose=False,
        )

        best: Optional[Detection] = None
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                conf = float(box.conf[0])
                cls_id = int(box.cls[0])
                label = result.names[cls_id]
                x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])

                if best is None or conf > best.confidence:
                    best = Detection(label=label, confidence=conf, bbox=(x1, y1, x2, y2))

        return best
