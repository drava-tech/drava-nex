"""
object.py — YOLO object-detection engine.

Wraps the trained Latticelane product-detection model (ultralytics YOLO on
PyTorch, cuDNN 9) and runs it in its own process — never shares a process with
the face engine (onnxruntime-gpu / cuDNN 8.9), see requirements-object.txt.

Ported from Latticelane_products/recognise_tiled_stable.py: SAHI-style tiled
inference (each tile run at native resolution so a small/far product is seen
much larger), boxes mapped back to full-frame coordinates and merged with a
single class-aware NMS pass.
"""

from __future__ import annotations
import logging
from dataclasses import dataclass

import numpy as np

from ..config import Config

log = logging.getLogger("vision.object")

# Tiling grid over the frame. 2 cols x 2 rows with overlap gives each object
# roughly 2x the pixels vs the downscaled full frame.
TILE_COLS = 2
TILE_ROWS = 2
OVERLAP = 0.2
IMGSZ = 1280

# Trained model's class names -> the CMS's detectionLabel slug (lowercase
# letters/digits/underscores only, per packages/types/src/products.ts's
# detectionLabelSchema). Fixed mapping — the class set is static/known, not
# runtime-slugified.
CLASS_NAME_TO_DETECTION_LABEL = {
    "Perpetual Calendar": "perpetual_calendar",
    "A6 Raw Press Lock Journal": "a6_raw_press_lock_journal",
    "Pen": "pen",
    "Leather Roll Up Small - Organizer": "leather_roll_up_organizer",
    "Card Holder": "card_holder",
}


@dataclass
class Detection:
    bbox: tuple[float, float, float, float]  # x1, y1, x2, y2 in full-frame pixels
    score: float
    detection_label: str


def _tile_windows(width: int, height: int, cols: int, rows: int, overlap: float):
    """Yield (x1, y1, x2, y2) tile windows covering the frame with overlap."""
    tile_w = int(width / (cols - (cols - 1) * overlap)) if cols > 1 else width
    tile_h = int(height / (rows - (rows - 1) * overlap)) if rows > 1 else height
    step_x = int(tile_w * (1 - overlap)) if cols > 1 else width
    step_y = int(tile_h * (1 - overlap)) if rows > 1 else height

    windows = []
    for r in range(rows):
        for c in range(cols):
            x1 = min(c * step_x, width - tile_w)
            y1 = min(r * step_y, height - tile_h)
            windows.append((x1, y1, x1 + tile_w, y1 + tile_h))
    return windows


def _global_nms(boxes, scores, labels, iou_thres):
    """Class-aware NMS across all merged tile detections. Returns kept indices."""
    if len(boxes) == 0:
        return []

    import torch
    from torchvision.ops import nms

    boxes_t = torch.tensor(boxes, dtype=torch.float32)
    scores_t = torch.tensor(scores, dtype=torch.float32)
    # Offset boxes per label so NMS never suppresses across different classes.
    label_ids = {label: i for i, label in enumerate(sorted(set(labels)))}
    classes_t = torch.tensor([label_ids[label] for label in labels], dtype=torch.float32)
    max_coord = boxes_t.max() if len(boxes_t) else 0
    offsets = classes_t * (max_coord + 1)
    shifted = boxes_t + offsets[:, None]

    keep = nms(shifted, scores_t, iou_thres)
    return keep.tolist()


class ObjectEngine:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._model = None

    def load(self) -> None:
        from ultralytics import YOLO

        log.info("[object] loading model from %s", self._cfg.object_model_path)
        self._model = YOLO(self._cfg.object_model_path)

    def detect(self, frame_bgr: np.ndarray) -> list[Detection]:
        """Tiled YOLO inference over the full frame. Returns full-frame-coordinate
        detections with model class names already mapped to detectionLabel slugs."""
        if self._model is None:
            raise RuntimeError("ObjectEngine.load() must be called first.")

        h, w = frame_bgr.shape[:2]
        windows = _tile_windows(w, h, TILE_COLS, TILE_ROWS, OVERLAP)

        all_boxes, all_scores, all_labels = [], [], []
        for (x1, y1, x2, y2) in windows:
            tile = frame_bgr[y1:y2, x1:x2]
            results = self._model(
                tile,
                conf=self._cfg.object_conf_threshold,
                iou=self._cfg.object_iou_threshold,
                imgsz=IMGSZ,
                verbose=False,
            )[0]
            if results.boxes is None:
                continue
            for box in results.boxes:
                bx1, by1, bx2, by2 = box.xyxy[0].cpu().numpy()
                class_name = self._model.names[int(box.cls[0].item())]
                label = CLASS_NAME_TO_DETECTION_LABEL.get(class_name)
                if label is None:
                    log.warning("[object] unmapped class name %r — skipping detection", class_name)
                    continue
                all_boxes.append([bx1 + x1, by1 + y1, bx2 + x1, by2 + y1])
                all_scores.append(float(box.conf[0].item()))
                all_labels.append(label)

        keep = _global_nms(all_boxes, all_scores, all_labels, self._cfg.object_iou_threshold)
        return [
            Detection(bbox=tuple(all_boxes[i]), score=all_scores[i], detection_label=all_labels[i])
            for i in keep
        ]
