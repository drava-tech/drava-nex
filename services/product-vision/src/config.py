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

    # CA certificate file to trust when ws_url is wss://. Only needed for a
    # locally-issued dev certificate (e.g. mkcert) that isn't in Python's default
    # trust store. Unused for ws:// or a publicly-trusted wss:// certificate.
    ca_cert_path: str | None = None

    # Camera backend: "opencv" (USB webcam, default) or "realsense" (Intel RealSense)
    camera_backend: str = "opencv"

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

    # When True, keep showing the last detected product after the object leaves
    # (never emit PRODUCT_LOST). When False, emit PRODUCT_LOST so the screen
    # reverts to its idle/assigned content.
    hold_product: bool = True

    # When True, on each detection the service queries the CMS API for the product
    # that the label maps to and prints it to this console (local debugging).
    debug_product_lookup: bool = True

    # Screen this camera is mapped to. Only needed when gate_template_key is set —
    # lets the service register for that screen's CONTENT_UPDATE broadcasts.
    screen_id: str | None = None

    # When set, detection only runs while the mapped screen's active experience
    # has this templateKey. None = always-on (continuous / Model A behavior).
    gate_template_key: str | None = None

    # Publish a small MJPEG preview of the camera feed over the gateway's live-stream
    # relay (streamId = camera_id), independent of the detection gate. Necessary
    # because the camera is exclusively claimed by this Docker container (via usbipd
    # passthrough) — the browser can't reach it directly via getUserMedia.
    preview_enabled: bool = True
    preview_fps: float = 8.0
    preview_max_width: int = 480
    preview_jpeg_quality: int = 70


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
        ca_cert_path=os.getenv("VISION_CA_CERT_PATH") or None,
        camera_backend=os.getenv("VISION_CAMERA_BACKEND", "opencv").lower(),
        opencv_device_index=int(os.getenv("VISION_OPENCV_DEVICE_INDEX", "0")),
        realsense_width=int(os.getenv("VISION_RS_WIDTH", "1280")),
        realsense_height=int(os.getenv("VISION_RS_HEIGHT", "720")),
        realsense_fps=int(os.getenv("VISION_RS_FPS", "30")),
        stability_frames=int(os.getenv("VISION_STABILITY_FRAMES", "5")),
        lost_frames=int(os.getenv("VISION_LOST_FRAMES", "10")),
        hold_product=os.getenv("VISION_HOLD_PRODUCT", "true").strip().lower()
        not in ("false", "0", "no"),
        debug_product_lookup=os.getenv("VISION_DEBUG_PRODUCT", "true").strip().lower()
        not in ("false", "0", "no"),
        screen_id=os.getenv("VISION_SCREEN_ID") or None,
        gate_template_key=os.getenv("VISION_GATE_TEMPLATE_KEY") or None,
        preview_enabled=os.getenv("VISION_PREVIEW_ENABLED", "true").strip().lower()
        not in ("false", "0", "no"),
        preview_fps=float(os.getenv("VISION_PREVIEW_FPS", "8.0")),
        preview_max_width=int(os.getenv("VISION_PREVIEW_MAX_WIDTH", "480")),
        preview_jpeg_quality=int(os.getenv("VISION_PREVIEW_JPEG_QUALITY", "70")),
    )
