"""
test_rtsp_camera.py — quick capture sanity check for camera_rtsp.RtspCamera.

Standalone counterpart to test_camera.py while the RTSP backend is still an
additive, not-yet-wired-in module (see camera_rtsp.py's module docstring).
Reads the RTSP URL straight from an env var rather than config.py/.env, since
config.py hasn't been extended with an rtsp_url field yet.

Usage (from services/vision/, venv active). Either set VISION_RTSP_URL
directly, or set VISION_TAPO_USER/VISION_TAPO_PASS/VISION_TAPO_IP (recommended
— avoids manually percent-encoding special characters in the password) in
.env:
    python scripts/test_rtsp_camera.py
"""

from __future__ import annotations
import logging
import os
import sys
import time

import cv2
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from vision.camera_rtsp import RtspCamera, rtsp_url_from_env  # noqa: E402


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_dotenv()

    url = rtsp_url_from_env()
    if not url:
        print("!! Set VISION_RTSP_URL, or VISION_TAPO_USER/PASS/IP, in .env first.")
        sys.exit(1)

    camera = RtspCamera(url)
    with camera:
        # Unlike OpenCVCamera/RealSenseCamera, RtspCamera.read_frame() is
        # non-blocking (it hands back whatever its background thread has
        # decoded so far) — so poll with a timeout instead of firing a fixed
        # number of instant reads, which would finish before the connection
        # handshake + first frame even completes.
        frame = None
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            frame = camera.read_frame()
            if frame is not None:
                break
            time.sleep(0.1)
        if frame is None:
            print("!! No frame received — check the camera connection/credentials.")
            sys.exit(1)
        out = "scratch_frame_rtsp.jpg"
        cv2.imwrite(out, frame)
        h, w = frame.shape[:2]
        print(f"OK: {w}x{h} frame written to {out}")


if __name__ == "__main__":
    main()
