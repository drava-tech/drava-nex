"""
object_pipeline.py — main loop: camera -> tiled YOLO detect -> mat ROI filter
-> majority-vote stabilize -> emit_inventory.

A separate flow from pipeline.py (face/visitor identity) — the two share only
camera.py, events.py and Config. Ported from
Latticelane_products/recognise_tiled_stable.py's smoothed_inventory/Stabilizer,
same constants/behavior (already tuned there against the trained model).
"""

from __future__ import annotations
import logging
import signal
import time
from collections import Counter, deque

from . import mat_roi
from .camera import make_camera
from .config import Config, load_config
from .engines.object import ObjectEngine
from .events import Events

log = logging.getLogger("vision.object_pipeline")

COUNT_HISTORY_SIZE = 8
ENTER_MIN_SEEN_FRAMES = 3   # frames needed within history to newly confirm a product
STAY_MIN_SEEN_FRAMES = 2    # lower bar to keep an already-confirmed product listed,
                            # so one dropped-confidence frame doesn't flicker it off
INVENTORY_STABLE_SECONDS = 0.8


def _smoothed_inventory(history, previously_stable_names=frozenset()):
    if not history:
        return Counter()

    counts_by_label = {}
    seen_frames = Counter()

    for frame_counts in history:
        for label, count in frame_counts.items():
            if count <= 0:
                continue
            seen_frames[label] += 1
            counts_by_label.setdefault(label, Counter())[count] += 1

    smoothed = Counter()
    for label, count_votes in counts_by_label.items():
        min_needed = STAY_MIN_SEEN_FRAMES if label in previously_stable_names else ENTER_MIN_SEEN_FRAMES
        if seen_frames[label] < min_needed:
            continue
        smoothed[label] = count_votes.most_common(1)[0][0]

    return smoothed


class _Stabilizer:
    """Rolling majority-vote state so a single dropped-confidence frame doesn't
    flicker a product on/off, and so the emitted inventory only fires once it's
    held steady for INVENTORY_STABLE_SECONDS."""

    def __init__(self) -> None:
        self.count_history = deque(maxlen=COUNT_HISTORY_SIZE)
        self.previously_stable_names: frozenset = frozenset()
        self.last_candidate_inventory: dict | None = None
        self.candidate_since: float | None = None
        self.emitted_inventory: dict | None = None

    def update(self, frame_counts: dict[str, int]) -> tuple[dict, bool]:
        self.count_history.append(frame_counts)
        inventory = _smoothed_inventory(self.count_history, self.previously_stable_names)
        self.previously_stable_names = frozenset(inventory.keys())
        candidate_inventory = dict(sorted(inventory.items()))

        now = time.monotonic()
        if candidate_inventory != self.last_candidate_inventory:
            self.last_candidate_inventory = candidate_inventory
            self.candidate_since = now

        # No `bool(candidate_inventory)` gate here — an empty mat that's held
        # steady for INVENTORY_STABLE_SECONDS is just as valid a stable state
        # as a non-empty one, and must be able to emit too. Without this, once
        # any inventory was ever confirmed, removing every item from the mat
        # could never be reported (an empty dict is falsy), leaving the CMS
        # stuck showing stale contents after the mat was actually cleared.
        is_ready = (
            self.candidate_since is not None
            and now - self.candidate_since >= INVENTORY_STABLE_SECONDS
        )
        return candidate_inventory, is_ready


class ObjectPipeline:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._engine = ObjectEngine(cfg)
        self._events = Events(cfg)
        self._stabilizer = _Stabilizer()
        self._mat_polygon_norm = None
        self._running = False
        self._frames = 0

    def _step(self, frame) -> None:
        dets = self._engine.detect(frame)

        if self._mat_polygon_norm is not None:
            h, w = frame.shape[:2]
            mat_polygon_px = mat_roi.polygon_for_frame(self._mat_polygon_norm, w, h)
            dets = [d for d in dets if mat_roi.is_on_mat(d.bbox, mat_polygon_px)]

        # At most one physical unit of each product — same assumption the
        # Latticelane recognise scripts make (best-per-class after NMS).
        frame_counts: dict[str, int] = {d.detection_label: 1 for d in dets}

        inventory, is_ready = self._stabilizer.update(frame_counts)
        if is_ready and inventory != self._stabilizer.emitted_inventory:
            self._events.emit_inventory(self._cfg.camera_id, inventory)
            self._stabilizer.emitted_inventory = inventory
            log.info("[object_pipeline] inventory update: %s", inventory)

    def run(self) -> None:
        self._engine.load()

        if self._cfg.object_mat_roi_path:
            try:
                self._mat_polygon_norm = mat_roi.load_normalized_polygon(
                    self._cfg.object_mat_roi_path
                )
                log.info("[object_pipeline] mat ROI loaded from %s", self._cfg.object_mat_roi_path)
            except mat_roi.MatRoiError as exc:
                log.warning(
                    "[object_pipeline] %s — running unfiltered (all detections count).",
                    exc,
                )

        self._running = True

        def _stop(*_args) -> None:
            log.info("[object_pipeline] Shutdown requested…")
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
                    log.info("[object_pipeline] %.1f fps", fps)
                    self._events.emit_status(self._cfg.camera_id, "detecting", fps)
                    # Re-send the current confirmed state even when it hasn't
                    # changed. emit_inventory in _step only fires on change,
                    # so a state that's been stable for a while would
                    # otherwise never reach the API again — meaning an API
                    # restart (which drops its in-memory "latest known mat
                    # state") could go stale until the mat next physically
                    # changes. This bounds that staleness to ~10s instead.
                    if self._stabilizer.emitted_inventory is not None:
                        self._events.emit_inventory(
                            self._cfg.camera_id, self._stabilizer.emitted_inventory
                        )
                    self._frames = 0
                    last_stats = now
        finally:
            camera.stop()
            self._events.emit_status(self._cfg.camera_id, "offline")
            self._events.close()
            log.info("[object_pipeline] Stopped.")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    cfg = load_config()
    log.info(
        "[object_pipeline] Starting — backend=%s model=%s conf=%.2f iou=%.2f",
        cfg.camera_backend, cfg.object_model_path, cfg.object_conf_threshold, cfg.object_iou_threshold,
    )
    ObjectPipeline(cfg).run()
