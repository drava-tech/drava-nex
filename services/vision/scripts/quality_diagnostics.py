"""
quality_diagnostics.py — logs det_score/blur/brightness/pose for EVERY
detected face, whether it passes is_good_quality() or not, so the quality
thresholds in angle_sampling.py can actually be validated against real
rejected frames — not just accepted ones.

The normal pipeline scripts only ever save/log samples that already passed
the quality gate (that's the whole point of the gate), so there was no way
to see what a genuinely blurry/bad-pose REJECTED frame actually measures.
This script detects faces but never tracks/matches/enrolls anything — it's
read-only against the DB, purely for eyeballing the numbers live.

Usage (from services/vision/, venv active). Reads camera vars from
services/vision/.env. To generate real motion blur, deliberately
move/turn your head quickly in front of the camera during the run.
    python scripts/quality_diagnostics.py
"""

from __future__ import annotations
import os
import sys
import time

import cv2
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from vision.angle_sampling import (  # noqa: E402
    BBOX_ASPECT_RANGE, FACE_ASPECT_RANGE, MAX_BRIGHTNESS, MIN_BLUR_VARIANCE, MIN_BRIGHTNESS,
    MIN_DET_SCORE_FOR_ENROLLMENT, MIN_LANDMARK_MARGIN_FRAC, NOSE_POSITION_RANGE,
    FrameSample, _crop_tight, is_good_quality, make_config,
)
from vision.camera_rtsp import RtspCamera, rtsp_url_from_env  # noqa: E402
from vision.engines.face import FaceEngine  # noqa: E402

RUN_SECONDS = 20.0


def _min_side(bbox) -> float:
    x1, y1, x2, y2 = (float(v) for v in bbox[:4])
    return min(x2 - x1, y2 - y1)


def main() -> None:
    load_dotenv()
    url = rtsp_url_from_env()
    if not url:
        print("!! Set VISION_RTSP_URL, or VISION_TAPO_USER/PASS/IP, in .env first.")
        sys.exit(1)

    cfg = make_config(database_url="unused", api_url="http://localhost:4000", broadcast_secret="unused",
                       camera_id="cam-quality-diag", min_bbox_px=40)

    print("Loading face engine (buffalo_l)...")
    engine = FaceEngine(cfg)
    engine.load()

    print(f"Thresholds: det_score>={MIN_DET_SCORE_FOR_ENROLLMENT}, "
          f"nose_position in {NOSE_POSITION_RANGE}, aspect in {FACE_ASPECT_RANGE}, "
          f"bbox_aspect in {BBOX_ASPECT_RANGE}, landmark_margin>={MIN_LANDMARK_MARGIN_FRAC}, "
          f"blur>={MIN_BLUR_VARIANCE}, brightness in [{MIN_BRIGHTNESS},{MAX_BRIGHTNESS}]")
    print(f"Running for {RUN_SECONDS:.0f}s — move/turn quickly to generate real motion blur...")

    camera = RtspCamera(url)
    with camera:
        start = time.monotonic()
        last_print = 0.0
        while time.monotonic() - start < RUN_SECONDS:
            frame = camera.read_frame()
            if frame is None:
                time.sleep(0.02)
                continue
            all_faces = engine.detect(frame)
            faces = [f for f in all_faces if _min_side(f.bbox) >= cfg.min_bbox_px]
            for face in faces:
                sample = FrameSample(face, frame)
                crop = _crop_tight(frame, face.bbox)
                blur = brightness = float("nan")
                if crop is not None:
                    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                    brightness = float(gray.mean())
                    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())

                # Same calcs as is_good_quality() itself — not exposed
                # separately, so duplicated here purely to log them.
                nose_position = aspect = bbox_aspect = top_margin = bottom_margin = float("nan")
                x1, y1, x2, y2 = (float(v) for v in face.bbox[:4])
                bbox_w, bbox_h = x2 - x1, y2 - y1
                left_eye, right_eye, nose, left_mouth, right_mouth = face.kps[:5]
                interocular = abs(right_eye[0] - left_eye[0])
                if interocular >= 1e-3:
                    eye_center_y = (left_eye[1] + right_eye[1]) / 2
                    mouth_center_y = (left_mouth[1] + right_mouth[1]) / 2
                    face_span = mouth_center_y - eye_center_y
                    if face_span >= 1e-3:
                        nose_position = (nose[1] - eye_center_y) / face_span
                        aspect = face_span / interocular
                    if bbox_h >= 1e-3:
                        bbox_aspect = bbox_w / bbox_h
                        top_margin = (eye_center_y - y1) / bbox_h
                        bottom_margin = (y2 - mouth_center_y) / bbox_h

                passed = is_good_quality(sample)
                now = time.monotonic()
                if now - last_print > 0.15:  # throttle — engine.detect() can run faster than this is useful to read
                    last_print = now
                    print(f"{'PASS' if passed else 'FAIL'}  det={face.det_score:.2f}  "
                          f"nose_pos={nose_position:5.2f}  aspect={aspect:4.2f}  "
                          f"bbox_aspect={bbox_aspect:4.2f}  top_m={top_margin:4.2f}  bot_m={bottom_margin:4.2f}  "
                          f"blur={blur:7.1f}  brightness={brightness:5.1f}  "
                          f"size={_min_side(face.bbox):.0f}px")

    print("Done.")


if __name__ == "__main__":
    main()
