"""
pipeline.py — main loop: camera → detect+embed → track → vote → match/enroll → persist.

Identity uses the multi-embedding + angle-sampling + temporal-voting path
(angle_sampling.py + db_face_recognition.py): one visitor → many stored angle
samples in visitor_embedding; a track votes across several good frames before
it's matched or enrolled. Face crops are stored in the DB (visitor/
visitor_embedding image_bytes), not on disk. New people enroll anonymously —
naming happens later in the CMS Visitors page; this daemon never prompts.

Per PENDING track: collect the actual per-frame face across the confirmation
window, quality-filter, and once MIN_SAMPLES_FOR_VOTE good samples agree
(vote_identity), either match an existing visitor or — only with enough
angle-diverse evidence that nobody matched — register a new one. IDENTIFIED
tracks keep bumping last_seen (cooldown-gated) and widen their stored angles.

Separately, every qualifying face also emits a cooldown-debounced, identity-
agnostic PERSON_PRESENT event straight off raw detection — no tracking or DB
round-trip — which drives the welcome-screen trigger.

"""

from __future__ import annotations
import base64
import logging
import signal
import time
from datetime import datetime, timezone

import cv2

from .camera import make_camera
from .config import Config, load_config
from .engines.face import FaceEngine
from .events import Events
from .tracker import IouTracker, TrackState
from .db_face_recognition import FaceRecognitionDb
from .angle_sampling import (
    MAJORITY_VOTE_THRESHOLD,
    MAX_PENDING_RAW_SAMPLES,
    MIN_PITCH_BUCKETS_TO_REGISTER,
    MIN_SAMPLES_FOR_VOTE,
    MIN_SAMPLES_TO_REGISTER,
    MIN_YAW_BUCKETS_TO_REGISTER,
    FrameSample,
    angle_bucket,
    collect_diverse_samples,
    face_for_track,
    filter_good_quality,
    maybe_capture_more,
    pitch_bucket,
    register_new_person,
    seed_samples,
    vote_identity,
    yaw_bucket,
)

log = logging.getLogger("vision.people")


def _min_side(bbox) -> float:
    x1, y1, x2, y2 = (float(v) for v in bbox[:4])
    return min(x2 - x1, y2 - y1)


_SNAPSHOT_MAX_WIDTH = 640


def _encode_snapshot(frame, faces, min_bbox_px: float, identified: list) -> str:
    """Draw detection boxes + identified names on a downscaled copy; base64 JPEG.

    `identified` is a list of (bbox, label) for tracks bound to a visitor, so the
    CMS preview shows who's in frame by name (green), matching the terminal
    output — not just a face count. Red boxes = detected but too small/far to
    identify.
    """
    h, w = frame.shape[:2]
    scale = min(1.0, _SNAPSHOT_MAX_WIDTH / w)
    out = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale < 1.0 else frame.copy()

    for f in faces:
        x1, y1, x2, y2 = (int(v * scale) for v in f.bbox[:4])
        counts = _min_side(f.bbox) >= min_bbox_px
        color = (0, 200, 0) if counts else (0, 0, 200)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)

    for bbox, label in identified:
        x1, y1, x2, y2 = (int(v * scale) for v in bbox[:4])
        cv2.rectangle(out, (x1, y1), (x2, y2), (0, 200, 0), 2)
        cv2.putText(out, label, (x1, max(y1 - 6, 14)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 0), 2)

    names = [label for _, label in identified]
    caption = "In frame: " + ", ".join(names) if names else f"faces: {len(faces)}"
    cv2.putText(out, caption, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return base64.b64encode(buf.tobytes()).decode("ascii") if ok else ""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Pipeline:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._db = FaceRecognitionDb(
            cfg.database_url, cfg.match_max_distance, cfg.cooldown_seconds
        )
        self._engine = FaceEngine(cfg)
        self._tracker = IouTracker(cfg)
        self._events = Events(cfg)
        # track_id -> raw per-frame samples collected while PENDING.
        self._pending: dict[int, list[FrameSample]] = {}
        # uuid -> visitor.name, cached for the snapshot labels; cleared every
        # 10s so names assigned in the CMS show up in the preview.
        self._names: dict[str, str] = {}
        self._running = False
        self._last_presence_emit = 0.0
        self._last_snapshot_emit = 0.0
        # per-10s stats
        self._frames = 0
        self._matches = 0
        self._enrolls = 0

    def _label(self, visitor_uuid: str) -> str:
        """Display name for the preview: the visitor's name, or Unknown-<id>
        while still anonymous. Cached (cleared every 10s)."""
        name = self._names.get(visitor_uuid)
        if name is None:
            row = self._db.query_one("SELECT name FROM visitor WHERE uuid = %s", (visitor_uuid,))
            name = row[0] if row and row[0] else ""
            self._names[visitor_uuid] = name
        return name if name else f"Unknown-{visitor_uuid[:8]}"

    def _resolve_pending(self, track, faces, frame) -> None:
        """Collect this frame's face for a PENDING track and, once enough good
        samples agree, match it to an existing visitor or register a new one."""
        buf = self._pending.setdefault(track.track_id, [])
        # .copy(): the frame gets reused; FrameSample must own the exact pixels.
        buf.append(FrameSample(face_for_track(track, faces), frame.copy()))
        if len(buf) > MAX_PENDING_RAW_SAMPLES:
            del buf[0]

        good = filter_good_quality(buf)
        if len(good) < MIN_SAMPLES_FOR_VOTE:
            return  # not enough evidence yet — stays Unknown, nothing written

        samples = collect_diverse_samples(good)
        best_uuid, fraction = vote_identity(self._db, samples)

        if best_uuid is not None and fraction >= MAJORITY_VOTE_THRESHOLD:
            self._pending.pop(track.track_id, None)
            self._db.touch(best_uuid)
            seed_samples(self._db, self._cfg, best_uuid, None, samples, skip_first=False)
            self._matches += 1
            # name="" — the CMS already has it; this just reorders/bumps the list.
            self._events.emit_visitor(best_uuid, "", False, _now_iso(), False)
            track.visitor_uuid = best_uuid
            track.state = TrackState.IDENTIFIED
            track.captured_buckets = {angle_bucket(s.face.kps) for s in samples}
            log.info(
                "[pipeline] Track %d matched visitor %s (%.0f%% vote, %d samples)",
                track.track_id, best_uuid, fraction * 100, len(samples),
            )
        elif (
            best_uuid is None
            and fraction >= MAJORITY_VOTE_THRESHOLD
            and len(samples) >= MIN_SAMPLES_TO_REGISTER
            and len({yaw_bucket(s.face.kps) for s in samples}) >= MIN_YAW_BUCKETS_TO_REGISTER
            and len({pitch_bucket(s.face.kps) for s in samples}) >= MIN_PITCH_BUCKETS_TO_REGISTER
        ):
            # Only register once enough diverse, good samples consistently fail
            # to match anyone — never off a single frame or a low-diversity run.
            self._pending.pop(track.track_id, None)
            visitor_uuid = register_new_person(self._db, self._cfg, samples)
            self._enrolls += 1
            self._events.emit_visitor(visitor_uuid, "", True, _now_iso(), True)
            track.visitor_uuid = visitor_uuid
            track.state = TrackState.IDENTIFIED
            track.captured_buckets = {angle_bucket(s.face.kps) for s in samples}
            log.info(
                "[pipeline] Track %d registered new visitor %s (%d samples, %.0f%% agreed none matched)",
                track.track_id, visitor_uuid, len(samples), fraction * 100,
            )
        # else: inconclusive (votes split, or not enough diverse evidence yet) —
        # keep gathering, stays Unknown, nothing written.

    def _step(self, frame) -> None:
        all_faces = self._engine.detect(frame)
        # Strict floor — feeds identity matching/enrollment only (data quality).
        faces = [f for f in all_faces if _min_side(f.bbox) >= self._cfg.min_bbox_px]
        # Looser floor — "someone is there" for the welcome-screen trigger,
        # independent of whether the face is good enough to identify.
        presence_faces = [
            f for f in all_faces if _min_side(f.bbox) >= self._cfg.presence_min_bbox_px
        ]

        # Identity-agnostic presence signal — fires straight off raw detection.
        if presence_faces:
            now_mono = time.monotonic()
            if now_mono - self._last_presence_emit >= self._cfg.presence_cooldown_seconds:
                self._events.emit_person_present(self._cfg.camera_id, len(presence_faces))
                self._last_presence_emit = now_mono

        # Identity path (DB-backed vote/match/enroll) — fully skipped when
        # disabled, so nothing here ever touches Postgres. Presence/trigger and
        # the snapshot preview are unaffected either way.
        if self._cfg.db_enabled:
            seen = self._tracker.update(faces)
            for track in seen:
                if track.state is TrackState.PENDING:
                    self._resolve_pending(track, faces, frame)
                elif track.visitor_uuid is not None:
                    if self._db.touch(track.visitor_uuid):
                        self._events.emit_visitor(track.visitor_uuid, "", False, _now_iso(), False)
                    # Keep widening this visitor's stored angle coverage.
                    maybe_capture_more(self._db, track, track.best_face, self._cfg, frame, None)

        # Debug snapshot for the CMS camera preview — cooldown-gated. Drawn
        # AFTER the identity path so identified tracks can be labeled by name.
        now_mono = time.monotonic()
        if now_mono - self._last_snapshot_emit >= self._cfg.snapshot_interval_seconds:
            labeled = [
                (t.bbox, self._label(t.visitor_uuid))
                for t in self._tracker.tracks
                if t.state is TrackState.IDENTIFIED and t.visitor_uuid is not None
            ]
            jpeg_b64 = _encode_snapshot(frame, all_faces, self._cfg.presence_min_bbox_px, labeled)
            if jpeg_b64:
                self._events.emit_snapshot(self._cfg.camera_id, jpeg_b64)
            self._last_snapshot_emit = now_mono

    def run(self) -> None:
        if self._cfg.db_enabled:
            self._db.connect()
        else:
            log.info("[pipeline] DB disabled (VISION_DB_ENABLED=false) — presence trigger only, no identity capture.")
        self._engine.load()

        self._running = True

        def _stop(*_args) -> None:
            log.info("[pipeline] Shutdown requested…")
            self._running = False

        signal.signal(signal.SIGINT, _stop)
        signal.signal(signal.SIGTERM, _stop)

        camera = make_camera(self._cfg)
        camera.start()
        last_stats = time.monotonic()
        try:
            while self._running:
                frame = camera.read_frame()
                if frame is None:
                    time.sleep(0.05)
                    continue
                self._step(frame)
                self._frames += 1

                now = time.monotonic()
                if now - last_stats >= 10.0:
                    elapsed = now - last_stats
                    fps = self._frames / elapsed
                    log.info(
                        "[pipeline] %.1f fps | %d active tracks | %d matches | %d enrolls",
                        fps,
                        len(self._tracker.tracks),
                        self._matches,
                        self._enrolls,
                    )
                    self._events.emit_status(self._cfg.camera_id, "detecting", fps)
                    self._frames = 0
                    self._matches = 0
                    self._enrolls = 0
                    if self._cfg.db_enabled:
                        self._db.prune_cooldowns()
                    # Drop pending buffers for tracks that aged out undecided.
                    live = {t.track_id for t in self._tracker.tracks}
                    self._pending = {tid: b for tid, b in self._pending.items() if tid in live}
                    # Refresh names so CMS-assigned names appear in the preview.
                    self._names.clear()
                    last_stats = now
        finally:
            camera.stop()
            if self._cfg.db_enabled:
                self._db.close()
            self._events.emit_status(self._cfg.camera_id, "offline")
            self._events.close()
            log.info("[pipeline] Stopped.")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    cfg = load_config()
    log.info(
        "[pipeline] Starting — backend=%s db_enabled=%s min_bbox=%dpx presence_min_bbox=%dpx "
        "match<=%.2f cooldown=%.0fs",
        cfg.camera_backend, cfg.db_enabled, cfg.min_bbox_px, cfg.presence_min_bbox_px,
        cfg.match_max_distance, cfg.cooldown_seconds,
    )
    Pipeline(cfg).run()
