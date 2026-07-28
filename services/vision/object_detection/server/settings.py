import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, field_validator

# Load services/vision/object_detection/.env explicitly (two levels up from this
# file), not cwd-relative — the server runs from services/ as
# `python -m vision.object_detection.server`, so a bare load_dotenv() would miss it.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# Kept relative to /app inside the image (see Dockerfile.server, which bakes the
# weight to /app/models/production/). Never an absolute host path — compose and
# the local-dev docs both set VISION_SERVER_MODEL_PATH explicitly.
_DEFAULT_MODEL_PATH = "/app/models/production/coster-v1.pt"


class VisionServerSettings(BaseModel):
    model_path: str = _DEFAULT_MODEL_PATH
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

    @property
    def model_file(self) -> str:
        """Weight filename for the `model` block in /vision/info and the WS
        responses. PurePath handles both / and \\ separators — a naive
        split("/") left the whole Windows path in the payload."""
        return Path(self.model_path).name

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
    model_path=os.environ.get("VISION_SERVER_MODEL_PATH") or os.environ.get("VISION_MODEL_PATH") or _DEFAULT_MODEL_PATH,
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
