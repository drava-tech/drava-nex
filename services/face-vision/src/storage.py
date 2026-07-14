"""
storage.py — face crop JPEGs on disk.

Files are named {uuid}.jpg inside Config.image_dir; the database stores only
the bare filename so the API can resolve it inside its own base directory
(same pattern as the media library's UPLOAD_DIR).
"""

from __future__ import annotations
import logging
import os

import cv2
import numpy as np

from .config import Config

log = logging.getLogger(__name__)

# Extra context around the detector's tight bbox so the saved photo is
# recognisable to staff (hair, chin), not just the facial core.
CROP_MARGIN = 0.25


def ensure_image_dir(cfg: Config) -> None:
    os.makedirs(cfg.image_dir, exist_ok=True)


def save_face_crop(
    cfg: Config, frame_bgr: np.ndarray, bbox: np.ndarray, visitor_uuid: str
) -> str | None:
    """Crop bbox (+margin, clamped to frame) and save as {uuid}.jpg.

    Returns the bare filename, or None if the crop failed (never raises —
    a missing photo must not abort an enrollment).
    """
    try:
        h, w = frame_bgr.shape[:2]
        x1, y1, x2, y2 = (float(v) for v in bbox[:4])
        mx = (x2 - x1) * CROP_MARGIN
        my = (y2 - y1) * CROP_MARGIN
        xa = max(0, int(x1 - mx))
        ya = max(0, int(y1 - my))
        xb = min(w, int(x2 + mx))
        yb = min(h, int(y2 + my))
        if xb - xa < 2 or yb - ya < 2:
            return None

        filename = f"{visitor_uuid}.jpg"
        path = os.path.join(cfg.image_dir, filename)
        if not cv2.imwrite(path, frame_bgr[ya:yb, xa:xb]):
            log.warning("[storage] cv2.imwrite failed for %s", path)
            return None
        return filename
    except Exception:
        log.warning("[storage] Face crop failed", exc_info=True)
        return None
