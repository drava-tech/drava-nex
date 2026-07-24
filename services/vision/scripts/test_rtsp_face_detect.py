"""
test_rtsp_face_detect.py — combined sanity check: RtspCamera + FaceEngine
(CUDA) end to end against a live IP camera feed.

Standalone, like test_rtsp_camera.py — see camera_rtsp.py's module docstring
for why this isn't wired into config.py/camera.py yet. Grabs frames for a few
seconds, runs real face detection+embedding on each, and reports how many
faces were seen and on which execution provider.

Usage (from services/vision/, venv active). Either set VISION_RTSP_URL
directly, or set VISION_TAPO_USER/VISION_TAPO_PASS/VISION_TAPO_IP (recommended
— avoids manually percent-encoding special characters in the password) in
.env:
    python scripts/test_rtsp_face_detect.py
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
from vision.config import Config  # noqa: E402
from vision.engines.face import FaceEngine  # noqa: E402

RUN_SECONDS = 8.0


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_dotenv()

    url = rtsp_url_from_env()
    if not url:
        print("!! Set VISION_RTSP_URL, or VISION_TAPO_USER/PASS/IP, in .env first.")
        sys.exit(1)

    cfg = Config(
        database_url="postgresql://unused:unused@localhost/unused",
        api_url="http://localhost:4000",
        broadcast_secret="unused",
        camera_id="cam-rtsp-test",
    )

    print("Loading face engine (buffalo_l)...")
    engine = FaceEngine(cfg)
    engine.load()

    camera = RtspCamera(url)
    with camera:
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

        print(f"Streaming for {RUN_SECONDS:.0f}s...")
        frames_processed = 0
        max_faces_seen = 0
        last_frame_with_face = None
        start = time.monotonic()
        while time.monotonic() - start < RUN_SECONDS:
            frame = camera.read_frame()
            if frame is None:
                time.sleep(0.02)
                continue
            faces = engine.detect(frame)
            frames_processed += 1
            if len(faces) > max_faces_seen:
                max_faces_seen = len(faces)
            if faces:
                last_frame_with_face = (frame, faces)

        elapsed = time.monotonic() - start
        print(f"Processed {frames_processed} frames in {elapsed:.1f}s "
              f"({frames_processed / elapsed:.1f} fps) — max faces in one frame: {max_faces_seen}")

        if last_frame_with_face is not None:
            frame, faces = last_frame_with_face
            for f in faces:
                x1, y1, x2, y2 = f.bbox.astype(int)
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            out = "scratch_face_detect.jpg"
            cv2.imwrite(out, frame)
            print(f"Wrote a frame with {len(faces)} detected face(s) to {out}")
        else:
            print("No faces detected in this run — point the camera at a face and rerun if unexpected.")


if __name__ == "__main__":
    main()
