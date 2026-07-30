"""
camera.py — Camera abstraction for the Face Vision service.

Adapted from services/product-vision/src/camera.py (same interface, FACE_*
env names). Supports two backends selected by Config.camera_backend:

  Option A — "opencv" (default, any USB/IP webcam)
      Uses OpenCV VideoCapture with the device index from Config.opencv_device_index.
      No extra SDK required.

  Option B — "realsense" (production, Intel RealSense D-series)
      Uses pyrealsense2 to open an RGB stream. The RealSense SDK must be
      installed on the host: https://github.com/IntelRealSense/librealsense/releases

Both backends expose the same interface:
    camera = make_camera(config)
    camera.start()
    frame = camera.read_frame()   # returns a numpy BGR uint8 array or None
    camera.stop()

Switch between backends by setting FACE_CAMERA_BACKEND=opencv|realsense in .env.
"""

from __future__ import annotations
import abc
import logging
import time
from typing import Optional

import numpy as np

from .config import Config

log = logging.getLogger(__name__)


class BaseCamera(abc.ABC):
    """Shared interface for all camera backends."""

    @abc.abstractmethod
    def start(self) -> None:
        """Open the camera device and start streaming."""

    @abc.abstractmethod
    def read_frame(self) -> Optional[np.ndarray]:
        """Return the latest BGR frame as a (H, W, 3) uint8 ndarray, or None on error."""

    @abc.abstractmethod
    def stop(self) -> None:
        """Release all camera resources."""

    def __enter__(self) -> "BaseCamera":
        self.start()
        return self

    def __exit__(self, *_) -> None:
        self.stop()


class RealSenseCamera(BaseCamera):
    """
    Intel RealSense RGB stream via pyrealsense2.

    Requires:
      - Intel RealSense SDK 2.0 installed (librealsense)
        https://github.com/IntelRealSense/librealsense/releases/latest
      - pip install pyrealsense2

    Only the colour stream is used for face recognition.
    Depth data is available through self._pipeline and can be added later.
    """

    # A dead USB/pipeline session (frame timeouts, or the SDK reporting the
    # pipeline as stopped) doesn't self-heal — read_frame() would otherwise
    # fail forever with nothing but a warning log. After this many
    # back-to-back failures, tear down and re-create the pipeline instead.
    _MAX_CONSECUTIVE_ERRORS = 5
    # Cooldown between reconnect attempts once the pipeline is torn down
    # (whether from a failed restart, or the device being physically
    # unplugged) — avoids hammering pipeline.start() every 50ms while the
    # device is genuinely gone, but still recovers within a few seconds once
    # Windows re-enumerates it.
    _RETRY_COOLDOWN_SECONDS = 3.0

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._pipeline = None
        self._align = None
        self._consecutive_errors = 0
        self._last_start_attempt = 0.0

    def start(self) -> None:
        try:
            import pyrealsense2 as rs  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "pyrealsense2 is not installed or the Intel RealSense SDK is missing.\n"
                "Install the SDK: https://github.com/IntelRealSense/librealsense/releases\n"
                "Then: pip install pyrealsense2\n"
                "Or switch to the OpenCV backend: FACE_CAMERA_BACKEND=opencv"
            ) from e

        self._rs = rs
        pipeline = rs.pipeline()
        config = rs.config()
        config.enable_stream(
            rs.stream.color,
            self._cfg.realsense_width,
            self._cfg.realsense_height,
            rs.format.bgr8,
            self._cfg.realsense_fps,
        )
        pipeline.start(config)
        self._pipeline = pipeline
        self._align = rs.align(rs.stream.color)
        self._consecutive_errors = 0
        log.info(
            "[camera] RealSense started — %dx%d @ %dfps",
            self._cfg.realsense_width,
            self._cfg.realsense_height,
            self._cfg.realsense_fps,
        )

    def read_frame(self) -> Optional[np.ndarray]:
        if self._pipeline is None:
            # No live pipeline — either never started, or a previous restart
            # attempt failed (e.g. the device was physically unplugged).
            # Keep retrying on a cooldown instead of giving up permanently.
            self._try_start()
            return None
        try:
            frames = self._pipeline.wait_for_frames(timeout_ms=2000)
            color_frame = frames.get_color_frame()
            if not color_frame:
                return None
            self._consecutive_errors = 0
            return np.asanyarray(color_frame.get_data())
        except Exception:
            self._consecutive_errors += 1
            log.warning(
                "[camera] RealSense frame error (%d consecutive)",
                self._consecutive_errors,
                exc_info=True,
            )
            if self._consecutive_errors >= self._MAX_CONSECUTIVE_ERRORS:
                self._teardown()
            return None

    def _try_start(self) -> None:
        now = time.monotonic()
        if now - self._last_start_attempt < self._RETRY_COOLDOWN_SECONDS:
            return
        self._last_start_attempt = now
        try:
            self.start()
            log.info("[camera] RealSense (re)connected")
        except Exception:
            log.warning("[camera] RealSense not available yet — will keep retrying", exc_info=True)

    def _teardown(self) -> None:
        log.error(
            "[camera] RealSense stream dead after %d consecutive errors — reconnecting",
            self._consecutive_errors,
        )
        self._consecutive_errors = 0
        try:
            if self._pipeline is not None:
                self._pipeline.stop()
        except Exception:
            log.warning("[camera] error stopping stale RealSense pipeline", exc_info=True)
        self._pipeline = None
        self._try_start()

    def stop(self) -> None:
        if self._pipeline:
            self._pipeline.stop()
            self._pipeline = None
        log.info("[camera] RealSense stopped")


class OpenCVCamera(BaseCamera):
    """
    Regular USB/IP webcam via OpenCV VideoCapture.

    No extra SDK required. Select the device with FACE_OPENCV_DEVICE_INDEX
    (default 0 = first webcam).
    """

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._cap = None

    def start(self) -> None:
        import cv2  # type: ignore

        cap = cv2.VideoCapture(self._cfg.opencv_device_index)
        if not cap.isOpened():
            raise RuntimeError(
                f"[camera] Cannot open OpenCV device index {self._cfg.opencv_device_index}. "
                "Check FACE_OPENCV_DEVICE_INDEX or try a different index."
            )
        self._cap = cap
        log.info("[camera] OpenCV webcam started (device %d)", self._cfg.opencv_device_index)

    def read_frame(self) -> Optional[np.ndarray]:
        if self._cap is None:
            return None
        ret, frame = self._cap.read()
        return frame if ret else None

    def stop(self) -> None:
        if self._cap:
            self._cap.release()
            self._cap = None
        log.info("[camera] OpenCV webcam stopped")


def make_camera(cfg: Config) -> BaseCamera:
    """Factory — returns the correct camera backend based on config."""
    if cfg.camera_backend == "realsense":
        return RealSenseCamera(cfg)
    elif cfg.camera_backend == "opencv":
        return OpenCVCamera(cfg)
    elif cfg.camera_backend == "rtsp":
        # IP camera (Tapo etc.) — reuse the additive RtspCamera. URL comes from
        # cfg.rtsp_url (VISION_RTSP_URL) or falls back to VISION_TAPO_* env vars.
        from .camera_rtsp import RtspCamera, rtsp_url_from_env

        url = cfg.rtsp_url or rtsp_url_from_env()
        if not url:
            raise ValueError(
                "camera_backend='rtsp' but no URL — set VISION_RTSP_URL or "
                "VISION_TAPO_USER/PASS/IP(/STREAM)."
            )
        return RtspCamera(url)
    else:
        raise ValueError(
            f"Unknown FACE_CAMERA_BACKEND '{cfg.camera_backend}'. "
            "Valid values: 'realsense', 'opencv', 'rtsp'"
        )
