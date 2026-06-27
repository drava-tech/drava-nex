"""
config.py — Environment configuration for the Product Vision service.

Reads from .env (via python-dotenv) and exposes typed, validated settings.
All required variables raise a clear error at startup if missing.
"""

import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Config:
    # Path to the YOLO .pt model file used for inference
    model_path: str

    # Minimum confidence score (0–1) for a detection to be reported
    confidence_threshold: float

    # Logical camera identifier sent in every detection event (e.g. "camera-01")
    camera_id: str

    # WebSocket URL of the CMS API gateway (e.g. "ws://192.168.1.100/ws/")
    ws_url: str

    # Camera backend: "realsense" (Intel RealSense, default) or "opencv" (USB webcam)
    camera_backend: str = "realsense"

    # OpenCV device index — only used when camera_backend = "opencv"
    opencv_device_index: int = 0

    # RealSense RGB stream resolution
    realsense_width: int = 1280
    realsense_height: int = 720
    realsense_fps: int = 30

    # How many consecutive stable frames before emitting PRODUCT_DETECTED
    stability_frames: int = 5

    # How many consecutive empty frames before emitting PRODUCT_LOST
    lost_frames: int = 10


def load_config() -> Config:
    """Load and validate configuration from environment variables."""

    def require(key: str) -> str:
        val = os.getenv(key)
        if not val:
            raise EnvironmentError(
                f"[config] Required env var '{key}' is not set. "
                f"Copy .env.example → .env and fill in the values."
            )
        return val

    confidence_raw = os.getenv("VISION_CONFIDENCE_THRESHOLD", "0.80")
    try:
        confidence = float(confidence_raw)
        assert 0.0 <= confidence <= 1.0
    except (ValueError, AssertionError):
        raise ValueError(
            f"[config] VISION_CONFIDENCE_THRESHOLD must be a float between 0 and 1, "
            f"got: '{confidence_raw}'"
        )

    return Config(
        model_path=require("VISION_MODEL_PATH"),
        confidence_threshold=confidence,
        camera_id=require("VISION_CAMERA_ID"),
        ws_url=require("CMS_WEBSOCKET_URL"),
        camera_backend=os.getenv("VISION_CAMERA_BACKEND", "realsense").lower(),
        opencv_device_index=int(os.getenv("VISION_OPENCV_DEVICE_INDEX", "0")),
        realsense_width=int(os.getenv("VISION_RS_WIDTH", "1280")),
        realsense_height=int(os.getenv("VISION_RS_HEIGHT", "720")),
        realsense_fps=int(os.getenv("VISION_RS_FPS", "30")),
        stability_frames=int(os.getenv("VISION_STABILITY_FRAMES", "5")),
        lost_frames=int(os.getenv("VISION_LOST_FRAMES", "10")),
    )
