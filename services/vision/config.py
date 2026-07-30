"""
config.py — Environment configuration for the Vision service.

Reads from .env (via python-dotenv) and exposes typed, validated settings.
Camera-specific vars (VISION_CAMERA_ID/BACKEND/INDEX) are injected per
subprocess by the supervisor; everything else is shared across workers.
"""

import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

# Load services/vision/.env explicitly (next to this file), not cwd-relative —
# `python -m vision` runs from services/, so a bare load_dotenv() would miss it.
load_dotenv(Path(__file__).with_name(".env"))


@dataclass(frozen=True)
class Config:
    # Postgres DSN — the service queries/inserts visitor rows directly.
    database_url: str

    # Base URL of the Hono API (for the internal event relay).
    api_url: str

    # Shared secret for POST /api/internal/vision-event (x-broadcast-secret).
    broadcast_secret: str

    # Logical camera id for this worker (set by the supervisor per subprocess).
    camera_id: str

    # Camera backend: "opencv" (USB webcam, default for dev), "realsense", or
    # "rtsp" (IP camera, e.g. Tapo — see camera_rtsp.py)
    camera_backend: str = "opencv"

    # OpenCV device index — only used when camera_backend = "opencv"
    opencv_device_index: int = 0

    # Pre-built RTSP URL — only used when camera_backend = "rtsp". Empty falls
    # back to rtsp_url_from_env() (VISION_TAPO_USER/PASS/IP/STREAM) in camera.py.
    rtsp_url: str = ""

    # RealSense RGB stream resolution
    realsense_width: int = 1280
    realsense_height: int = 720
    realsense_fps: int = 30

    # Master switch for the identity path (DB connection, face matching/
    # enrollment, visitor table writes, face-crop images). When false, the
    # pipeline never connects to Postgres at all — only the identity-agnostic
    # PERSON_PRESENT/welcome-screen trigger and the CMS camera preview run.
    db_enabled: bool = True

    # insightface model pack (SCRFD detector + ArcFace recognizer, 512-d)
    model_pack: str = "buffalo_l"
    model_root: str = "./models"

    # Detector input size (square) and confidence floor
    det_size: int = 640
    det_score_threshold: float = 0.5

    # Minimum face bbox shorter side, in source-frame pixels. Gates identity
    # matching/enrollment (visitor table) — kept strict for data quality.
    min_bbox_px: int = 80

    # Separate, looser floor for the identity-agnostic PERSON_PRESENT signal
    # (welcome-screen trigger) — lets "someone is there" fire at a distance
    # too far for reliable face identification. Defaults to min_bbox_px.
    presence_min_bbox_px: int = 80

    # Cosine-distance ceiling for a DB match (pgvector <=> = 1 - cosine sim).
    match_max_distance: float = 0.5

    # Per-visitor debounce for last_seen writes / live events.
    cooldown_seconds: float = 30.0

    # Debounce for the identity-agnostic PERSON_PRESENT event (drives the
    # welcome-screen trigger) — independent of the visitor match/enroll cooldown.
    presence_cooldown_seconds: float = 5.0

    # How often a debug snapshot (JPEG, boxes drawn) is sent for the CMS camera
    # preview. Purely a visual aid — unrelated to detection/trigger logic.
    snapshot_interval_seconds: float = 1.5

    # Where cropped face JPEGs are written (API serves them from the same dir).
    image_dir: str = "./data/faces"

    # Days a face JPEG is kept before scripts/purge_images.py removes it.
    image_retention_days: int = 30

    # Tracker
    track_iou_threshold: float = 0.3
    track_max_misses: int = 15
    track_confirm_frames: int = 3
    reverify_seconds: float = 60.0

    # ─── Object detection (mat product detector) ───────────────────────────────
    # Path to the trained YOLO weights (ultralytics .pt).
    object_model_path: str = "./models/latticelane-detector.pt"
    object_conf_threshold: float = 0.25
    object_iou_threshold: float = 0.6
    # Calibrated mat polygon (see mat_roi.py, scripts/calibrate_mat.py). Empty
    # string disables the mat filter — every detection anywhere in frame counts.
    object_mat_roi_path: str = "./data/mat_roi.json"


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

    def env_float(key: str, default: str, lo: float, hi: float) -> float:
        raw = os.getenv(key, default)
        try:
            val = float(raw)
            assert lo <= val <= hi
        except (ValueError, AssertionError):
            raise ValueError(
                f"[config] {key} must be a number between {lo} and {hi}, got: '{raw}'"
            )
        return val

    return Config(
        database_url=require("VISION_DATABASE_URL"),
        db_enabled=os.getenv("VISION_DB_ENABLED", "true").strip().lower() not in ("false", "0", "no"),
        api_url=os.getenv("VISION_API_URL", "http://localhost:4000").rstrip("/"),
        broadcast_secret=os.getenv("BROADCAST_SECRET", ""),
        # The supervisor sets these per subprocess; sensible fallbacks let a
        # single worker be run standalone for debugging.
        camera_id=os.getenv("VISION_CAMERA_ID", "cam-entrance"),
        camera_backend=os.getenv("VISION_CAMERA_BACKEND", "opencv").lower(),
        opencv_device_index=int(
            os.getenv("VISION_CAMERA_INDEX", os.getenv("VISION_OPENCV_DEVICE_INDEX", "0"))
        ),
        rtsp_url=os.getenv("VISION_RTSP_URL", ""),
        realsense_width=int(os.getenv("VISION_RS_WIDTH", "1280")),
        realsense_height=int(os.getenv("VISION_RS_HEIGHT", "720")),
        realsense_fps=int(os.getenv("VISION_RS_FPS", "30")),
        model_pack=os.getenv("VISION_MODEL_PACK", "buffalo_l"),
        model_root=os.getenv("VISION_MODEL_ROOT", "./models"),
        det_size=int(os.getenv("VISION_DET_SIZE", "640")),
        det_score_threshold=env_float("VISION_DET_SCORE_THRESHOLD", "0.5", 0.0, 1.0),
        min_bbox_px=int(os.getenv("VISION_MIN_BBOX_PX", "80")),
        presence_min_bbox_px=int(
            os.getenv("VISION_PRESENCE_MIN_BBOX_PX", os.getenv("VISION_MIN_BBOX_PX", "80"))
        ),
        match_max_distance=env_float("VISION_MATCH_MAX_DISTANCE", "0.5", 0.0, 2.0),
        cooldown_seconds=env_float("VISION_COOLDOWN_SECONDS", "30", 0.0, 86400.0),
        presence_cooldown_seconds=env_float("VISION_PRESENCE_COOLDOWN_SECONDS", "5", 0.0, 300.0),
        snapshot_interval_seconds=env_float("VISION_SNAPSHOT_INTERVAL_SECONDS", "1.5", 0.0, 60.0),
        image_dir=os.getenv("VISION_IMAGE_DIR", "./data/faces"),
        image_retention_days=int(os.getenv("VISION_IMAGE_RETENTION_DAYS", "30")),
        track_iou_threshold=env_float("VISION_TRACK_IOU_THRESHOLD", "0.3", 0.0, 1.0),
        track_max_misses=int(os.getenv("VISION_TRACK_MAX_MISSES", "15")),
        track_confirm_frames=int(os.getenv("VISION_TRACK_CONFIRM_FRAMES", "3")),
        reverify_seconds=env_float("VISION_REVERIFY_SECONDS", "60", 1.0, 86400.0),
        object_model_path=os.getenv("VISION_OBJECT_MODEL_PATH", "./models/latticelane-detector.pt"),
        object_conf_threshold=env_float("VISION_OBJECT_CONF_THRESHOLD", "0.25", 0.0, 1.0),
        object_iou_threshold=env_float("VISION_OBJECT_IOU_THRESHOLD", "0.6", 0.0, 1.0),
        object_mat_roi_path=os.getenv("VISION_OBJECT_MAT_ROI_PATH", "./data/mat_roi.json"),
    )
