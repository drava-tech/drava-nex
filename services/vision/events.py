"""
events.py — fire-and-forget event relay to the Hono API.

Posts detection events to POST {api_url}/api/internal/vision-event with the
shared-secret header. Sending happens on a background daemon thread behind a
bounded queue, so:
  - the detection loop never blocks on network I/O, and
  - an API outage drops events quietly (queue overflow is discarded) instead of
    stalling or crashing the pipeline. DB writes are the source of truth; these
    events are only a live-UI nicety.

Uses stdlib urllib — no extra dependency.
"""

from __future__ import annotations
import json
import logging
import queue
import threading
import urllib.request
from typing import Optional

from .config import Config

log = logging.getLogger("vision.events")

_MAX_QUEUE = 256
_SENTINEL = object()


class Events:
    def __init__(self, cfg: Config) -> None:
        self._url = f"{cfg.api_url}/api/internal/vision-event"
        self._secret = cfg.broadcast_secret
        self._q: "queue.Queue[object]" = queue.Queue(maxsize=_MAX_QUEUE)
        self._thread = threading.Thread(target=self._run, name="vision-events", daemon=True)
        self._thread.start()

    def _enqueue(self, payload: dict) -> None:
        try:
            self._q.put_nowait(payload)
        except queue.Full:
            # API is slow/down — drop the live event; the DB row already exists.
            log.debug("[events] queue full, dropping %s", payload.get("type"))

    def emit_visitor(
        self, uuid: str, name: str, is_new: bool, last_seen: str, has_image: bool
    ) -> None:
        self._enqueue({
            "type": "VISITOR_DETECTED",
            "uuid": uuid, "name": name, "isNew": is_new,
            "lastSeen": last_seen, "hasImage": has_image,
        })

    def emit_status(self, camera_id: str, status: str, fps: Optional[float] = None) -> None:
        self._enqueue({
            "type": "CAMERA_STATUS", "cameraId": camera_id, "status": status, "fps": fps,
        })

    def emit_product(self, camera_id: str, label: str, confidence: float) -> None:
        # Defined for the future object worker; unused today.
        self._enqueue({
            "type": "PRODUCT_DETECTED", "cameraId": camera_id,
            "label": label, "confidence": confidence,
        })

    def _run(self) -> None:
        while True:
            item = self._q.get()
            if item is _SENTINEL:
                return
            try:
                self._post(item)  # type: ignore[arg-type]
            except Exception:
                log.debug("[events] send failed", exc_info=True)

    def _post(self, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self._url,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "x-broadcast-secret": self._secret,
            },
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            resp.read()

    def close(self) -> None:
        self._q.put(_SENTINEL)
        self._thread.join(timeout=2)
