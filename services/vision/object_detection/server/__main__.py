"""Entry point: `python -m vision.object_detection.server` (run from services/).

Runs in its own process — never alongside the face pipeline (`python -m vision`),
whose onnxruntime-gpu CUDA/cuDNN stack conflicts with torch's.
"""

import uvicorn

from vision.object_detection.server.settings import settings

if __name__ == "__main__":
    uvicorn.run(
        "vision.object_detection.server.app:create_app",
        host="0.0.0.0",
        port=settings.port,
        factory=True,
        log_level="info",
        access_log=False,
    )
