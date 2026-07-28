"""
config.py — Environment configuration for the object-detection TRAINING scripts.

Reads from .env (via python-dotenv) and exposes typed, validated settings.
All required variables raise a clear error at startup if missing.

Not used by the inference server — that has its own VISION_SERVER_* config in
server/settings.py. This one drives the local-camera capture/label/live-test
tooling under ../scripts/.
"""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load services/vision/object_detection/.env explicitly, not cwd-relative — the
# scripts are run as `python -m vision.object_detection.scripts.<name>` from
# services/, so a bare load_dotenv() would miss it.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")


@dataclass(frozen=True)
class Config:
    # Path to the YOLO .pt model file used for inference
    model_path: str

    # Minimum confidence score (0–1) for a detection to be reported
    confidence_threshold: float

    # Camera backend: "opencv" (USB webcam, default) or "realsense" (Intel RealSense)
    camera_backend: str = "opencv"

    # OpenCV device index — only used when camera_backend = "opencv"
    opencv_device_index: int = 0

    # RealSense RGB stream resolution
    realsense_width: int = 1280
    realsense_height: int = 720
    realsense_fps: int = 30

# Removed with the move to services/vision: ws_url / ca_cert_path / camera_id /
# stability_frames / lost_frames / hold_product / screen_id / gate_template_key /
# preview_* all belonged to a headless Python detection client that no longer
# exists. Detection runs in the browser now (packages/vision-browser →
# /vision/ws), where stability/lost framing lives in vision-browser's
# constants.ts and the camera↔screen mapping lives in the API (CAMERA_SCREEN_MAP).


def load_config() -> Config:
    """Load and validate configuration from environment variables."""

    def require(*keys: str) -> str:
        for key in keys:
            val = os.getenv(key)
            if val:
                return val
        raise EnvironmentError(
            f"[config] Required env var '{keys[0]}' is not set. "
            f"Copy .env.example → .env and fill in the values."
        )

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
        # Accepts VISION_SERVER_MODEL_PATH too so a single .env can drive both the
        # local server run and the evaluate/export/live_test scripts.
        model_path=require("VISION_MODEL_PATH", "VISION_SERVER_MODEL_PATH"),
        confidence_threshold=confidence,
        camera_backend=os.getenv("VISION_CAMERA_BACKEND", "opencv").lower(),
        opencv_device_index=int(os.getenv("VISION_OPENCV_DEVICE_INDEX", "0")),
        realsense_width=int(os.getenv("VISION_RS_WIDTH", "1280")),
        realsense_height=int(os.getenv("VISION_RS_HEIGHT", "720")),
        realsense_fps=int(os.getenv("VISION_RS_FPS", "30")),
    )
