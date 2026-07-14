"""
tracker.py — greedy IoU multi-face tracker.

Keeps one Track per person currently in frame so groups entering together are
identified individually and a person is matched against the database once per
visit, not once per frame. Deliberately simple (no Kalman/ByteTrack): faces at
an entrance move slowly relative to 15-30 fps, so bbox overlap between
consecutive frames is a reliable association signal. If ID switches show up in
dense crowds, ByteTrack (e.g. via the `supervision` package) is a drop-in
upgrade behind this same interface.
"""

from __future__ import annotations
import itertools
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from .config import Config


class TrackState(Enum):
    PENDING = "pending"        # collecting confirm frames before identification
    IDENTIFIED = "identified"  # bound to a visitor uuid


@dataclass
class Track:
    track_id: int
    bbox: tuple[float, float, float, float]
    state: TrackState = TrackState.PENDING
    misses: int = 0
    confirm_count: int = 0
    visitor_uuid: Optional[str] = None
    # Best face seen so far (highest det_score * bbox area) — its embedding is
    # what gets matched/enrolled, so we identify from the clearest view.
    best_face: Any = None
    best_score: float = 0.0
    last_verify_ts: float = field(default_factory=time.monotonic)
    # Set for one update() cycle when the face was seen in the current frame.
    seen_this_frame: bool = False


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0.0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter)


def _bbox_of(face: Any) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = (float(v) for v in face.bbox[:4])
    return (x1, y1, x2, y2)


def _quality(face: Any) -> float:
    x1, y1, x2, y2 = _bbox_of(face)
    return float(face.det_score) * max(0.0, (x2 - x1) * (y2 - y1))


class IouTracker:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._tracks: dict[int, Track] = {}
        self._next_id = itertools.count(1)

    @property
    def tracks(self) -> list[Track]:
        return list(self._tracks.values())

    def update(self, faces: list[Any]) -> list[Track]:
        """Associate this frame's faces with tracks; return tracks seen this frame."""
        for track in self._tracks.values():
            track.seen_this_frame = False

        # Greedy association: best-overlap pairs first.
        pairs: list[tuple[float, int, int]] = []
        face_boxes = [_bbox_of(f) for f in faces]
        for t_id, track in self._tracks.items():
            for f_idx, box in enumerate(face_boxes):
                iou = _iou(track.bbox, box)
                if iou >= self._cfg.track_iou_threshold:
                    pairs.append((iou, t_id, f_idx))
        pairs.sort(reverse=True)

        matched_tracks: set[int] = set()
        matched_faces: set[int] = set()
        for iou, t_id, f_idx in pairs:
            if t_id in matched_tracks or f_idx in matched_faces:
                continue
            matched_tracks.add(t_id)
            matched_faces.add(f_idx)
            track = self._tracks[t_id]
            face = faces[f_idx]
            track.bbox = face_boxes[f_idx]
            track.misses = 0
            track.seen_this_frame = True
            quality = _quality(face)
            if quality > track.best_score:
                track.best_score = quality
                track.best_face = face

        # Unmatched faces start new pending tracks.
        for f_idx, face in enumerate(faces):
            if f_idx in matched_faces:
                continue
            track = Track(
                track_id=next(self._next_id),
                bbox=face_boxes[f_idx],
                best_face=face,
                best_score=_quality(face),
                seen_this_frame=True,
            )
            self._tracks[track.track_id] = track

        # Unmatched tracks age out.
        for t_id in list(self._tracks):
            track = self._tracks[t_id]
            if not track.seen_this_frame:
                track.misses += 1
                if track.misses > self._cfg.track_max_misses:
                    del self._tracks[t_id]

        return [t for t in self._tracks.values() if t.seen_this_frame]
