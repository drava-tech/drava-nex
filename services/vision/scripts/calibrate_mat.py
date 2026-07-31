"""
calibrate_mat.py — click the mat's 4 corners once per physical camera/mat
setup to calibrate the mat ROI used by object_pipeline.py to only count
detections that sit on the mat.

Re-run this any time the camera or mat is physically moved.

Uses the same camera abstraction as the rest of the service (vision.camera /
Config), so it opens the camera exactly the way the OBJECT worker will.

Usage (from services/vision/, venv active):
    python scripts/calibrate_mat.py
    python scripts/calibrate_mat.py --source path/to/saved_frame.jpg
"""

from __future__ import annotations
import argparse
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from vision.camera import make_camera  # noqa: E402
from vision.config import load_config  # noqa: E402
from vision import mat_roi  # noqa: E402

state = {"points": []}


def np_points(points):
    return np.array(points, dtype=np.int32).reshape((-1, 1, 2))


def draw_overlay(frame, points):
    display = frame.copy()

    for i, (x, y) in enumerate(points, start=1):
        cv2.circle(display, (x, y), 6, (0, 255, 0), -1)
        cv2.putText(display, str(i), (x + 10, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

    if len(points) >= 2:
        for i in range(len(points) - 1):
            cv2.line(display, points[i], points[i + 1], (0, 255, 0), 2)

    if len(points) == 4:
        cv2.line(display, points[3], points[0], (0, 255, 0), 2)
        overlay = display.copy()
        cv2.fillPoly(overlay, [np_points(points)], (0, 200, 255))
        display = cv2.addWeighted(overlay, 0.25, display, 0.75, 0)

    cv2.putText(
        display,
        "Click 4 mat corners in order (e.g. clockwise from top-left)",
        (20, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        2,
    )
    cv2.putText(
        display,
        f"Points: {len(points)}/4  |  z undo  c clear  s save  q quit",
        (20, display.shape[0] - 20),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        (0, 255, 255),
        2,
    )
    return display


def mouse_callback(event, x, y, flags, param):
    if event == cv2.EVENT_LBUTTONDOWN and len(state["points"]) < 4:
        state["points"].append((x, y))


def try_save(out_path, points, frame_width, frame_height, source):
    if len(points) != 4:
        print(f"Need exactly 4 points before saving ({len(points)} so far).")
        return False

    if not mat_roi.is_simple_quadrilateral(points):
        print(
            "Points look out of order (polygon crosses itself) — click corners "
            "in sequence around the mat edge, then try again."
        )
        return False

    area = cv2.contourArea(np_points(points))
    frame_area = frame_width * frame_height
    if area < 0.01 * frame_area:
        print(f"Warning: calibrated area is small ({area:.0f}px of {frame_area}px frame) — saving anyway.")

    norm_points = [(x / frame_width, y / frame_height) for x, y in points]
    mat_roi.save_polygon(out_path, norm_points, (frame_width, frame_height), source=source)

    print(f"Saved mat ROI (4 points) to {out_path} — calibrated at {frame_width}x{frame_height}.")
    print("Re-run this any time the camera or mat physically moves.")
    print("The OBJECT worker loads this path from VISION_OBJECT_MAT_ROI_PATH.")
    return True


def run_loop(get_frame, out_path, frame_width, frame_height, source):
    window = "Calibrate mat ROI"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(window, mouse_callback)

    while True:
        frame = get_frame()
        if frame is None:
            continue

        display = draw_overlay(frame, state["points"])
        cv2.imshow(window, display)

        key = cv2.waitKey(20) & 0xFF
        if key == ord("z"):
            if state["points"]:
                state["points"].pop()
        elif key == ord("c"):
            state["points"] = []
        elif key == ord("s"):
            try_save(out_path, state["points"], frame_width, frame_height, source)
        elif key == ord("q"):
            break

    cv2.destroyAllWindows()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=mat_roi.DEFAULT_ROI_PATH)
    parser.add_argument("--source", default="camera", help="'camera' to use the configured VISION_CAMERA_BACKEND, or a path to a saved image")
    args = parser.parse_args()

    if args.source == "camera":
        cfg = load_config()
        camera = make_camera(cfg)
        camera.start()
        try:
            # Actual frame size (not just cfg.realsense_width/height, since
            # opencv/rtsp backends don't honor those fields) — grab one first.
            first = None
            while first is None:
                first = camera.read_frame()
            h, w = first.shape[:2]
            print(f"Live {cfg.camera_backend} feed at {w}x{h}. Click the mat's 4 corners.")
            run_loop(camera.read_frame, args.out, w, h, cfg.camera_backend)
        finally:
            camera.stop()
    else:
        image = cv2.imread(args.source)
        if image is None:
            print(f"Could not read image: {args.source}")
            return
        h, w = image.shape[:2]
        print(f"Loaded {args.source} ({w}x{h}). Click the mat's 4 corners.")
        run_loop(lambda: image, args.out, w, h, args.source)


if __name__ == "__main__":
    main()
