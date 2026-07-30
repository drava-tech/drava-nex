"""Shared mat-ROI polygon logic used by scripts/calibrate_mat.py and
object_pipeline.py. Keeps the JSON schema and polygon math in one place so the
calibration tool (writer) and the detection pipeline (reader) can't drift out
of sync.

Ported from Latticelane_products/mat_roi.py — unchanged, it's already generic.
"""

import json
from pathlib import Path

import cv2
import numpy as np

DEFAULT_ROI_PATH = "./data/mat_roi.json"


class MatRoiError(RuntimeError):
    """Raised with an actionable message when the ROI file is missing/invalid."""


def load_normalized_polygon(path=DEFAULT_ROI_PATH):
    """Load + validate the calibrated mat polygon.

    Returns 4 (x, y) tuples normalized to [0, 1]. Raises MatRoiError on any
    problem, with a message pointing at scripts/calibrate_mat.py.
    """
    p = Path(path)
    if not p.exists():
        raise MatRoiError(
            f"No mat ROI file at '{path}'. Run `python scripts/calibrate_mat.py` "
            "first to mark the mat's corners, or set VISION_OBJECT_MAT_ROI_PATH "
            "to an existing file, or run with mat filtering disabled."
        )

    try:
        data = json.loads(p.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        raise MatRoiError(f"Could not read mat ROI file '{path}': {exc}") from exc

    points = data.get("points_normalized")
    if not isinstance(points, list) or len(points) != 4:
        raise MatRoiError(
            f"Mat ROI file '{path}' must have exactly 4 points_normalized "
            f"(found {len(points) if isinstance(points, list) else 'none'}). "
            "Re-run `python scripts/calibrate_mat.py`."
        )

    norm_points = []
    for pt in points:
        if not (isinstance(pt, list) and len(pt) == 2):
            raise MatRoiError(f"Malformed point in '{path}': {pt!r}")
        x, y = float(pt[0]), float(pt[1])
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            raise MatRoiError(
                f"Point {pt!r} in '{path}' is outside the normalized [0, 1] range."
            )
        norm_points.append((x, y))

    return norm_points


def polygon_for_frame(norm_points, frame_width, frame_height):
    """Scale normalized points to this frame's absolute pixel coordinates.

    Returns an int32 ndarray shaped (4, 1, 2), usable directly with both
    cv2.pointPolygonTest and cv2.polylines/fillPoly.
    """
    pixel_points = [
        (x * frame_width, y * frame_height) for x, y in norm_points
    ]
    return np.array(pixel_points, dtype=np.int32).reshape((-1, 1, 2))


def box_footprint(xyxy):
    """Bottom-center point of (x1, y1, x2, y2) — the ground-contact approximation.

    Bottom-center rather than box-center: the camera views the mat at an angle,
    and an object's base (lowest point in the box) is what's actually touching
    the mat, regardless of the object's height. Box-center would be biased
    upward for tall items.
    """
    x1, y1, x2, y2 = xyxy
    return (float(x1 + x2) / 2.0, float(y2))


def is_on_mat(xyxy, pixel_polygon):
    """True if the box's footprint is inside or on the polygon boundary."""
    fx, fy = box_footprint(xyxy)
    return cv2.pointPolygonTest(pixel_polygon, (fx, fy), False) >= 0


def is_simple_quadrilateral(points):
    """Reject self-intersecting ("bowtie") quadrilaterals from out-of-order
    clicks. Only the 2 non-adjacent edge pairs of a 4-point polygon can cross.
    """
    if len(points) != 4:
        return False

    def segments_intersect(p1, p2, p3, p4):
        def orientation(a, b, c):
            val = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1])
            if val == 0:
                return 0
            return 1 if val > 0 else 2

        def on_segment(a, b, c):
            return (
                min(a[0], c[0]) <= b[0] <= max(a[0], c[0])
                and min(a[1], c[1]) <= b[1] <= max(a[1], c[1])
            )

        o1 = orientation(p1, p2, p3)
        o2 = orientation(p1, p2, p4)
        o3 = orientation(p3, p4, p1)
        o4 = orientation(p3, p4, p2)

        if o1 != o2 and o3 != o4:
            return True
        if o1 == 0 and on_segment(p1, p3, p2):
            return True
        if o2 == 0 and on_segment(p1, p4, p2):
            return True
        if o3 == 0 and on_segment(p3, p1, p4):
            return True
        if o4 == 0 and on_segment(p3, p2, p4):
            return True
        return False

    edge_12 = (points[0], points[1])
    edge_23 = (points[1], points[2])
    edge_34 = (points[2], points[3])
    edge_41 = (points[3], points[0])

    if segments_intersect(*edge_12, *edge_34):
        return False
    if segments_intersect(*edge_23, *edge_41):
        return False
    return True


def save_polygon(path, norm_points, calibration_resolution, source="realsense"):
    """Write the mat ROI JSON schema shared with load_normalized_polygon."""
    from datetime import datetime

    data = {
        "points_normalized": [[x, y] for x, y in norm_points],
        "calibration_resolution": list(calibration_resolution),
        "calibrated_at": datetime.now().isoformat(timespec="seconds"),
        "source": source,
    }
    out_path = Path(path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, indent=2))
