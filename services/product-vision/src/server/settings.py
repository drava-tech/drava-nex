import os
from dotenv import load_dotenv
from pydantic import BaseModel, field_validator

# ponytail: load local env settings for development fallback
load_dotenv()


class VisionServerSettings(BaseModel):
    model_path: str = "/app/models/production/coster-v1.pt"
    device: str = "cuda:0"
    conf_threshold: float = 0.4
    model_id: str = "coster"
    model_version: str = "1.0.0"
    model_sha256: str | None = None
    max_frame_bytes: int = 1048576
    min_frame_interval_ms: int = 100
    max_connections: int = 4
    inference_timeout_ms: int = 2000
    port: int = 8000

    @field_validator("device")
    @classmethod
    def validate_device(cls, v: str) -> str:
        if not v.startswith("cuda"):
            raise ValueError("VISION_SERVER_DEVICE must start with 'cuda'. CPU fallback is disabled.")
        return v

    @field_validator("conf_threshold")
    @classmethod
    def validate_conf(cls, v: float) -> float:
        if not (0.0 <= v <= 1.0):
            raise ValueError("VISION_SERVER_CONF_THRESHOLD must be between 0.0 and 1.0.")
        return v

# Load environment variables manually
settings = VisionServerSettings(
    model_path=os.environ.get("VISION_SERVER_MODEL_PATH") or os.environ.get("VISION_MODEL_PATH") or "/app/models/production/coster-v1.pt",
    device=os.environ.get("VISION_SERVER_DEVICE") or os.environ.get("VISION_DEVICE") or "cuda:0",
    conf_threshold=float(os.environ.get("VISION_SERVER_CONF_THRESHOLD") or os.environ.get("VISION_CONFIDENCE_THRESHOLD") or "0.4"),
    model_id=os.environ.get("VISION_SERVER_MODEL_ID", "coster"),
    model_version=os.environ.get("VISION_SERVER_MODEL_VERSION", "1.0.0"),
    model_sha256=os.environ.get("VISION_SERVER_MODEL_SHA256") or None,
    max_frame_bytes=int(os.environ.get("VISION_SERVER_MAX_FRAME_BYTES", "1048576")),
    min_frame_interval_ms=int(os.environ.get("VISION_SERVER_MIN_FRAME_INTERVAL_MS", "100")),
    max_connections=int(os.environ.get("VISION_SERVER_MAX_CONNECTIONS", "4")),
    inference_timeout_ms=int(os.environ.get("VISION_SERVER_INFERENCE_TIMEOUT_MS", "2000")),
    port=int(os.environ.get("VISION_SERVER_PORT", "8000")),
)
