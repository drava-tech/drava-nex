"""
camera_rtsp.py — RTSP IP-camera backend (e.g. Tapo TC70 or similar), additive
to the existing camera.py backends ("opencv", "realsense").

Standalone for now by design: it implements the same BaseCamera interface
(start/read_frame/stop) from .camera but takes an explicit `rtsp_url`
constructor argument instead of a Config object, so it doesn't require any
changes to config.py/camera.py/supervisor.py to exist and be tested. Once
reviewed, wiring it in is a small, mechanical change:
  - config.py:     add `rtsp_url: str = ""` to Config + its env parsing
  - camera.py:     add an `elif cfg.camera_backend == "rtsp": return RtspCamera(cfg.rtsp_url)`
                   branch to make_camera()
  - supervisor.py: pass a `VISION_CAMERA_RTSP_URL` env var through _spawn()
                   when the camera entry has a "url" field
  - .env.example:  document VISION_CAMERA_RTSP_URL / backend "rtsp"

Usage (standalone):
    camera = RtspCamera("rtsp://user:pass@192.168.1.100:554/stream1")
    camera.start()
    frame = camera.read_frame()
    camera.stop()

Why this needs its own frame-freshness handling (unlike OpenCVCamera's plain
blocking cap.read()): a local USB webcam only produces a frame when asked, but
an IP camera's encoder keeps pushing frames over the network continuously
whether or not anything reads them. If face detection is slower than the
camera's frame rate, frames queue up in the decoder and the pipeline ends up
processing progressively older frames — the feed *looks* like it's lagging
more and more the longer it runs. RtspCamera reads on its own background
thread and always hands back only the newest frame, discarding anything
unread, so latency stays flat instead of growing.
"""

from __future__ import annotations
import logging
import os
import threading
import time
import urllib.parse
from typing import Optional

import numpy as np

from .camera import BaseCamera

log = logging.getLogger(__name__)

_RECONNECT_DELAY_SECONDS = 2.0


def tapo_rtsp_url(user: str, password: str, ip: str, stream: str = "stream1") -> str:
    """Build a Tapo RTSP URL from separate credential fields, URL-encoding the
    password so special characters (@, $, etc.) don't break the URL — this is
    why credentials belong in separate env vars rather than a hand-built URL
    string where the password would need to be percent-encoded manually."""
    encoded_pass = urllib.parse.quote(password, safe="")
    return f"rtsp://{user}:{encoded_pass}@{ip}:554/{stream}"


def rtsp_url_from_env() -> str:
    """Resolve the camera URL from env vars, in priority order:
    1. VISION_RTSP_URL — a fully pre-built URL, used as-is
    2. VISION_TAPO_USER/PASS/IP(/STREAM) — built via tapo_rtsp_url()
    Returns "" if neither is set."""
    direct = os.environ.get("VISION_RTSP_URL", "")
    if direct:
        return direct

    user = os.environ.get("VISION_TAPO_USER", "")
    password = os.environ.get("VISION_TAPO_PASS", "")
    ip = os.environ.get("VISION_TAPO_IP", "")
    if user and password and ip:
        stream = os.environ.get("VISION_TAPO_STREAM", "stream1")
        return tapo_rtsp_url(user, password, ip, stream)

    return ""


class RtspCamera(BaseCamera):
    """
    IP camera via an RTSP URL, decoded by OpenCV's FFmpeg backend.

    Configure with an RTSP URL, e.g.:
      rtsp://<camera-account-user>:<camera-account-pass>@<camera-ip>:554/stream1

    Tapo cameras: enable "Camera Account" under Advanced Settings > Camera
    Account in the Tapo app to get RTSP credentials. stream1 = full-resolution
    main stream (1920x1080 on the TC70), stream2 = lower-res sub-stream.
    stream1 is used here — verified at 1920x1080 / ~22 fps end to end with GPU
    detection, still comfortably real-time for an entrance camera.
    """

    def __init__(self, rtsp_url: str) -> None:
        if not rtsp_url:
            raise ValueError("RtspCamera requires a non-empty rtsp_url")
        self._url = rtsp_url
        self._cap = None
        self._frame: Optional[np.ndarray] = None
        self._got_frame = False
        self._lock = threading.Lock()
        self._stopped = False
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        import cv2  # type: ignore

        # Must be set before VideoCapture(..., cv2.CAP_FFMPEG) is called.
        # Forces TCP (more reliable than UDP over Wi-Fi) and tells FFmpeg not
        # to hold frames in its own buffer.
        os.environ.setdefault(
            "OPENCV_FFMPEG_CAPTURE_OPTIONS",
            "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay|max_delay;100000",
        )

        self._cap = self._open(cv2)
        self._stopped = False
        self._thread = threading.Thread(target=self._update, daemon=True)
        self._thread.start()
        log.info("[camera_rtsp] RTSP stream started")

    def _open(self, cv2) -> "cv2.VideoCapture":
        cap = cv2.VideoCapture(self._url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not cap.isOpened():
            raise RuntimeError(
                "[camera_rtsp] Cannot open RTSP stream. Check the URL "
                "(host/credentials) and that the camera's RTSP account is enabled."
            )
        return cap

    def _update(self) -> None:
        import cv2  # type: ignore

        while not self._stopped:
            ok, frame = self._cap.read()
            if not ok:
                log.warning("[camera_rtsp] RTSP read failed, reconnecting…")
                self._cap.release()
                time.sleep(_RECONNECT_DELAY_SECONDS)
                try:
                    self._cap = self._open(cv2)
                except RuntimeError:
                    continue
                continue
            with self._lock:
                self._frame = frame
                self._got_frame = True

    def read_frame(self) -> Optional[np.ndarray]:
        with self._lock:
            if not self._got_frame or self._frame is None:
                return None
            return self._frame.copy()

    def stop(self) -> None:
        self._stopped = True
        if self._thread is not None:
            self._thread.join(timeout=2)
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        log.info("[camera_rtsp] RTSP stream stopped")
