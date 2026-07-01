"""
camera.py — Camera abstraction for the Product Vision service.

Supports two backends selected by Config.camera_backend:

  Option A — "realsense" (default, Intel RealSense D-series)
      Uses pyrealsense2 to open an RGB stream. The RealSense SDK must be
      installed on the host: https://github.com/IntelRealSense/librealsense/releases

  Option B — "opencv" (fallback, any USB/IP webcam)
      Uses OpenCV VideoCapture with the device index from Config.opencv_device_index.
      No extra SDK required.

Both backends expose the same interface:
    camera = make_camera(config)
    camera.start()
    frame = camera.read_frame()   # returns a numpy BGR uint8 array or None
    camera.stop()

Switch between backends by setting VISION_CAMERA_BACKEND=realsense|opencv in .env.
"""

from __future__ import annotations
import abc
import logging
from typing import Optional

import numpy as np

from config import Config

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

    Only the colour stream is used for object detection.
    Depth data is available through self._pipeline and can be added later.
    """

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._pipeline = None
        self._align = None

    def start(self) -> None:
        try:
            import pyrealsense2 as rs  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "pyrealsense2 is not installed or the Intel RealSense SDK is missing.\n"
                "Install the SDK: https://github.com/IntelRealSense/librealsense/releases\n"
                "Then: pip install pyrealsense2\n"
                "Or switch to the OpenCV backend: VISION_CAMERA_BACKEND=opencv"
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
        log.info(
            "[camera] RealSense started — %dx%d @ %dfps",
            self._cfg.realsense_width,
            self._cfg.realsense_height,
            self._cfg.realsense_fps,
        )

    def read_frame(self) -> Optional[np.ndarray]:
        if self._pipeline is None:
            return None
        try:
            frames = self._pipeline.wait_for_frames(timeout_ms=2000)
            color_frame = frames.get_color_frame()
            if not color_frame:
                return None
            return np.asanyarray(color_frame.get_data())
        except Exception:
            log.warning("[camera] RealSense frame error", exc_info=True)
            return None

    def stop(self) -> None:
        if self._pipeline:
            self._pipeline.stop()
            self._pipeline = None
        log.info("[camera] RealSense stopped")


class OpenCVCamera(BaseCamera):
    """
    Regular USB/IP webcam via OpenCV VideoCapture.

    No extra SDK required. Select the device with VISION_OPENCV_DEVICE_INDEX
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
                "Check VISION_OPENCV_DEVICE_INDEX or try a different index."
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
    else:
        raise ValueError(
            f"Unknown VISION_CAMERA_BACKEND '{cfg.camera_backend}'. "
            "Valid values: 'realsense', 'opencv'"
        )
