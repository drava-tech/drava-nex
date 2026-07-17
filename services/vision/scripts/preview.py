"""
preview.py — live detection sanity check.

Opens the configured camera and runs the same SCRFD face detector used by the
production pipeline (vision/engines/face.py), drawing a box around every
detected face in a live window. Use this to visually confirm the camera + GPU
detector see a human before relying on the PERSON_PRESENT event that drives
the welcome-screen trigger.

Green box = counts as a person (clears VISION_MIN_BBOX_PX).
Red box   = detected but too small/far to count.

Does not touch the database or POST any event — safe to run anytime.

Usage (from services/vision/, venv active):
    python scripts/preview.py

Press 'q' in the window to quit.
"""

from __future__ import annotations
import logging
import os
import sys

import cv2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from vision.camera import make_camera  # noqa: E402
from vision.config import load_config  # noqa: E402
from vision.engines.face import FaceEngine  # noqa: E402


def _min_side(bbox) -> float:
    x1, y1, x2, y2 = (float(v) for v in bbox[:4])
    return min(x2 - x1, y2 - y1)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = load_config()

    print(f"Loading detector (backend={cfg.camera_backend})…")
    engine = FaceEngine(cfg)
    engine.load()

    camera = make_camera(cfg)
    camera.start()
    print("Camera started. Press 'q' in the preview window to quit.")

    try:
        while True:
            frame = camera.read_frame()
            if frame is None:
                continue

            faces = engine.detect(frame)
            present = 0
            for f in faces:
                x1, y1, x2, y2 = (int(v) for v in f.bbox[:4])
                counts = _min_side(f.bbox) >= cfg.min_bbox_px
                present += 1 if counts else 0
                color = (0, 200, 0) if counts else (0, 0, 200)
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                cv2.putText(
                    frame,
                    f"{f.det_score:.2f}",
                    (x1, max(0, y1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    color,
                    2,
                )

            cv2.putText(
                frame,
                f"faces: {len(faces)}  present: {present}",
                (10, 24),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (255, 255, 255),
                2,
            )
            cv2.imshow("vision preview - press q to quit", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        camera.stop()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
