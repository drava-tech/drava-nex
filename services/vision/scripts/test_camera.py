"""
test_camera.py — quick capture sanity check for the configured backend.

Opens the camera from .env (FACE_CAMERA_BACKEND), grabs a few frames and
writes the last one to scratch_frame.jpg so you can verify aim and focus.

Usage (from services/face-vision/, venv active):
    python scripts/test_camera.py
"""

from __future__ import annotations
import logging
import os
import sys

import cv2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.camera import make_camera  # noqa: E402
from src.config import load_config  # noqa: E402


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = load_config()
    camera = make_camera(cfg)
    with camera:
        frame = None
        for i in range(30):
            frame = camera.read_frame()
        if frame is None:
            print("!! No frame received — check the camera connection/backend.")
            sys.exit(1)
        out = "scratch_frame.jpg"
        cv2.imwrite(out, frame)
        h, w = frame.shape[:2]
        print(f"OK: {w}x{h} frame written to {out}")


if __name__ == "__main__":
    main()
