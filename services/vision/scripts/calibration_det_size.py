"""
calibration_det_size.py — measures whether a larger detector input size
(det_size) actually improves embedding consistency for the small faces this
camera produces, instead of assuming it does.

Captures a batch of real frames once, then runs face detection+embedding
against that *same* batch at two different det_size settings, grouping
detections into per-person tracks via the existing IouTracker for each run
independently. For each setting, reports:
  - mean intra-person distance (same track, different frames) — lower is
    better: it means repeated sightings of the same real person embed
    consistently.
  - mean inter-person distance (different tracks) — higher is better: it
    means different people are well separated.
  - the gap between them — the real signal. A small/negative gap means no
    threshold can reliably tell people apart at this camera's face size,
    regardless of software tuning.

Usage (from services/vision/, venv active):
    python scripts/calibration_det_size.py
"""

from __future__ import annotations
import itertools
import os
import sys
import time

import numpy as np
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from vision.camera_rtsp import RtspCamera, rtsp_url_from_env  # noqa: E402
from vision.config import Config  # noqa: E402
from vision.engines.face import FaceEngine  # noqa: E402
from vision.tracker import IouTracker  # noqa: E402

CAPTURE_SECONDS = 12.0
MIN_BBOX_PX = 30
DET_SIZES = (640, 960)


def _min_side(bbox) -> float:
    x1, y1, x2, y2 = (float(v) for v in bbox[:4])
    return min(x2 - x1, y2 - y1)


def capture_frames(url: str, seconds: float) -> list:
    camera = RtspCamera(url)
    frames = []
    with camera:
        deadline = time.monotonic() + 10.0
        frame = None
        while time.monotonic() < deadline:
            frame = camera.read_frame()
            if frame is not None:
                break
            time.sleep(0.1)
        if frame is None:
            print("!! No frame received.")
            sys.exit(1)

        print(f"Capturing frames for {seconds:.0f}s...")
        start = time.monotonic()
        while time.monotonic() - start < seconds:
            frame = camera.read_frame()
            if frame is not None:
                frames.append(frame)
            time.sleep(0.03)
    print(f"Captured {len(frames)} frames.")
    return frames


def evaluate(engine: FaceEngine, cfg: Config, frames: list) -> None:
    tracker = IouTracker(cfg)
    embeddings_by_track: dict[int, list[np.ndarray]] = {}

    t0 = time.time()
    for frame in frames:
        all_faces = engine.detect(frame)
        faces = [f for f in all_faces if _min_side(f.bbox) >= MIN_BBOX_PX]
        seen = tracker.update(faces)
        # Re-derive this frame's face-per-track via bbox match (tracker
        # doesn't expose it directly) so we get every sighting, not just
        # track.best_face.
        for track in seen:
            for f in faces:
                fb = f.bbox
                if (abs(fb[0] - track.bbox[0]) < 2 and abs(fb[1] - track.bbox[1]) < 2
                        and abs(fb[2] - track.bbox[2]) < 2 and abs(fb[3] - track.bbox[3]) < 2):
                    embeddings_by_track.setdefault(track.track_id, []).append(f.normed_embedding)
                    break
    dt = time.time() - t0
    fps = len(frames) / dt if dt > 0 else 0.0

    intra_distances = []
    for track_id, embs in embeddings_by_track.items():
        if len(embs) < 2:
            continue
        for a, b in itertools.combinations(embs, 2):
            intra_distances.append(1.0 - float(np.dot(a, b)))

    # Representative (mean) embedding per track for inter-person comparison.
    reps = {tid: np.mean(embs, axis=0) for tid, embs in embeddings_by_track.items() if embs}
    for tid in reps:
        reps[tid] = reps[tid] / np.linalg.norm(reps[tid])
    inter_distances = []
    for (id_a, emb_a), (id_b, emb_b) in itertools.combinations(reps.items(), 2):
        inter_distances.append(1.0 - float(np.dot(emb_a, emb_b)))

    print(f"  tracks seen: {len(embeddings_by_track)}  "
          f"samples/track: {[len(v) for v in embeddings_by_track.values()]}  "
          f"processing fps: {fps:.1f}")
    if intra_distances:
        print(f"  intra-person distance: mean={np.mean(intra_distances):.4f} "
              f"max={np.max(intra_distances):.4f}  (n={len(intra_distances)})")
    else:
        print("  intra-person distance: n/a (no track had >=2 samples)")
    if inter_distances:
        print(f"  inter-person distance: mean={np.mean(inter_distances):.4f} "
              f"min={np.min(inter_distances):.4f}  (n={len(inter_distances)})")
    else:
        print("  inter-person distance: n/a (fewer than 2 tracks)")
    if intra_distances and inter_distances:
        gap = np.min(inter_distances) - np.max(intra_distances)
        print(f"  worst-case gap (min inter - max intra): {gap:.4f}  "
              f"({'separable' if gap > 0 else 'OVERLAPPING — unreliable at any threshold'})")


def main() -> None:
    load_dotenv()
    url = rtsp_url_from_env()
    if not url:
        print("!! Set VISION_RTSP_URL, or VISION_TAPO_USER/PASS/IP, in .env first.")
        sys.exit(1)

    frames = capture_frames(url, CAPTURE_SECONDS)

    for det_size in DET_SIZES:
        print(f"\n=== det_size={det_size} ===")
        cfg = Config(
            database_url="unused", api_url="x", broadcast_secret="x",
            camera_id="cam-calib", det_size=det_size,
        )
        engine = FaceEngine(cfg)
        engine.load()
        evaluate(engine, cfg, frames)


if __name__ == "__main__":
    main()
