"""
config.py — Environment configuration for the Face Vision service.

Reads from .env (via python-dotenv) and exposes typed, validated settings.
All required variables raise a clear error at startup if missing.
"""

import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Config:
    # Postgres DSN — the service queries/inserts visitor rows directly.
    # Dev example: postgresql://user:pass@192.168.0.250:5432/cms_platform
    database_url: str

    # Camera backend: "opencv" (USB webcam, default for dev) or "realsense"
    camera_backend: str = "opencv"

    # OpenCV device index — only used when camera_backend = "opencv"
    opencv_device_index: int = 0

    # RealSense RGB stream resolution
    realsense_width: int = 1280
    realsense_height: int = 720
    realsense_fps: int = 30

    # insightface model pack (SCRFD detector + ArcFace recognizer, 512-d)
    model_pack: str = "buffalo_l"

    # insightface cache root — the pack (~300 MB) auto-downloads here on first
    # run. Kept inside the service dir (gitignored) instead of %USERPROFILE%.
    model_root: str = "./models"

    # Detector input size (square) and confidence floor
    det_size: int = 640
    det_score_threshold: float = 0.5

    # Minimum face bbox shorter side, in source-frame pixels. Faces smaller
    # than this are background passers-by and never reach identification.
    min_bbox_px: int = 80

    # Cosine-distance ceiling for a DB match (pgvector <=> operator equals
    # 1 - cosine similarity on the normalized ArcFace embeddings). Kept
    # conservative: a false merge silently pollutes an identity, a false
    # new-enroll is just a duplicate row staff can merge later.
    match_max_distance: float = 0.5

    # Per-visitor debounce for last_seen writes — someone standing in front of
    # the camera must not generate dozens of UPDATEs per second.
    cooldown_seconds: float = 30.0

    # Where cropped face JPEGs are written. The API serves them from the same
    # location (FACE_IMAGE_DIR on the api side). Prod: E:/EC/cms-platform-data/faces
    image_dir: str = "./data/faces"

    # Days a face JPEG is kept before scripts/purge_images.py removes it
    # (the embedding row is kept — anonymized recognition still works).
    image_retention_days: int = 30

    # Tracker: detection↔track IoU association threshold
    track_iou_threshold: float = 0.3
    # Frames a track survives unmatched before it is dropped
    track_max_misses: int = 15
    # Consecutive qualifying frames before a track is identified against the DB
    track_confirm_frames: int = 3
    # Seconds between re-verifications of a long-lived track (guards ID switches)
    reverify_seconds: float = 60.0


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
        database_url=require("FACE_DATABASE_URL"),
        camera_backend=os.getenv("FACE_CAMERA_BACKEND", "opencv").lower(),
        opencv_device_index=int(os.getenv("FACE_OPENCV_DEVICE_INDEX", "0")),
        realsense_width=int(os.getenv("FACE_RS_WIDTH", "1280")),
        realsense_height=int(os.getenv("FACE_RS_HEIGHT", "720")),
        realsense_fps=int(os.getenv("FACE_RS_FPS", "30")),
        model_pack=os.getenv("FACE_MODEL_PACK", "buffalo_l"),
        model_root=os.getenv("FACE_MODEL_ROOT", "./models"),
        det_size=int(os.getenv("FACE_DET_SIZE", "640")),
        det_score_threshold=env_float("FACE_DET_SCORE_THRESHOLD", "0.5", 0.0, 1.0),
        min_bbox_px=int(os.getenv("FACE_MIN_BBOX_PX", "80")),
        match_max_distance=env_float("FACE_MATCH_MAX_DISTANCE", "0.5", 0.0, 2.0),
        cooldown_seconds=env_float("FACE_COOLDOWN_SECONDS", "30", 0.0, 86400.0),
        image_dir=os.getenv("FACE_IMAGE_DIR", "./data/faces"),
        image_retention_days=int(os.getenv("FACE_IMAGE_RETENTION_DAYS", "30")),
        track_iou_threshold=env_float("FACE_TRACK_IOU_THRESHOLD", "0.3", 0.0, 1.0),
        track_max_misses=int(os.getenv("FACE_TRACK_MAX_MISSES", "15")),
        track_confirm_frames=int(os.getenv("FACE_TRACK_CONFIRM_FRAMES", "3")),
        reverify_seconds=env_float("FACE_REVERIFY_SECONDS", "60", 1.0, 86400.0),
    )
