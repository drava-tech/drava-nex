"""
pipeline.py — main loop: camera → detect+embed → track → match/enroll → persist.

Per qualifying face (bbox shorter side >= FACE_MIN_BBOX_PX):
  - a PENDING track collects FACE_TRACK_CONFIRM_FRAMES frames, then its best
    view is matched against the visitor table by cosine distance;
  - distance <= FACE_MATCH_MAX_DISTANCE  → existing visitor: bump last_seen
    (cooldown-gated), no new photo;
  - otherwise (or empty table)           → new visitor: insert row, save the
    face crop as {uuid}.jpg, store the filename;
  - IDENTIFIED tracks keep bumping last_seen through the cooldown and are
    re-verified every FACE_REVERIFY_SECONDS in case the tracker swapped
    identities in a crowd.
"""

from __future__ import annotations
import logging
import signal
import time
from datetime import datetime, timezone

from .camera import make_camera
from .config import Config, load_config
from .db import Db
from .engines.face import FaceEngine
from .events import Events
from .matcher import Matcher
from .storage import ensure_image_dir, save_face_crop
from .tracker import IouTracker, Track, TrackState

log = logging.getLogger("vision.people")


def _min_side(bbox) -> float:
    x1, y1, x2, y2 = (float(v) for v in bbox[:4])
    return min(x2 - x1, y2 - y1)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Pipeline:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._db = Db(cfg)
        self._engine = FaceEngine(cfg)
        self._tracker = IouTracker(cfg)
        self._matcher = Matcher(cfg, self._db)
        self._events = Events(cfg)
        self._running = False
        # per-second stats
        self._frames = 0
        self._matches = 0
        self._enrolls = 0

    def _identify(self, track: Track, frame) -> None:
        """Bind a confirmed PENDING track to a visitor row (match or enroll)."""
        embedding = track.best_face.normed_embedding
        nearest = self._matcher.find_nearest(embedding)

        if nearest is not None and nearest[1] <= self._cfg.match_max_distance:
            visitor_uuid, distance = nearest
            wrote = self._matcher.touch(visitor_uuid)
            self._matches += 1
            log.info(
                "[pipeline] Track %d matched visitor %s (distance %.3f)",
                track.track_id, visitor_uuid, distance,
            )
            if wrote:
                # name="" — the CMS already has it from GET /api/visitors; this
                # event only triggers a reorder/last-seen bump in the live list.
                self._events.emit_visitor(visitor_uuid, "", False, _now_iso(), False)
        else:
            visitor_uuid = self._matcher.enroll(embedding)
            filename = save_face_crop(self._cfg, frame, track.best_face.bbox, visitor_uuid)
            if filename is not None:
                self._matcher.set_image(visitor_uuid, filename)
            self._enrolls += 1
            log.info(
                "[pipeline] Track %d enrolled new visitor %s (nearest distance %s)",
                track.track_id, visitor_uuid,
                f"{nearest[1]:.3f}" if nearest else "n/a — empty table",
            )
            self._events.emit_visitor(visitor_uuid, "", True, _now_iso(), filename is not None)

        track.visitor_uuid = visitor_uuid
        track.state = TrackState.IDENTIFIED
        track.last_verify_ts = time.monotonic()

    def _reverify(self, track: Track) -> None:
        """Re-run NN on a long-lived track; rebind if the tracker swapped people."""
        nearest = self._matcher.find_nearest(track.best_face.normed_embedding)
        track.last_verify_ts = time.monotonic()
        if nearest is None:
            return
        visitor_uuid, distance = nearest
        if distance <= self._cfg.match_max_distance and visitor_uuid != track.visitor_uuid:
            log.info(
                "[pipeline] Track %d re-verified to visitor %s (was %s, distance %.3f)",
                track.track_id, visitor_uuid, track.visitor_uuid, distance,
            )
            track.visitor_uuid = visitor_uuid

    def _step(self, frame) -> None:
        faces = self._engine.detect(frame)
        faces = [f for f in faces if _min_side(f.bbox) >= self._cfg.min_bbox_px]
        seen = self._tracker.update(faces)

        now = time.monotonic()
        for track in seen:
            if track.state is TrackState.PENDING:
                track.confirm_count += 1
                if track.confirm_count >= self._cfg.track_confirm_frames:
                    self._identify(track, frame)
            elif track.visitor_uuid is not None:
                if self._matcher.touch(track.visitor_uuid):
                    self._events.emit_visitor(track.visitor_uuid, "", False, _now_iso(), False)
                if now - track.last_verify_ts > self._cfg.reverify_seconds:
                    self._reverify(track)

    def run(self) -> None:
        ensure_image_dir(self._cfg)
        self._db.connect()
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
                    self._matcher.prune_cooldowns()
                    last_stats = now
        finally:
            camera.stop()
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
        "[pipeline] Starting — backend=%s min_bbox=%dpx match<=%.2f cooldown=%.0fs",
        cfg.camera_backend, cfg.min_bbox_px, cfg.match_max_distance, cfg.cooldown_seconds,
    )
    Pipeline(cfg).run()
