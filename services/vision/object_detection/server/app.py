import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from vision.object_detection.server.engine import engine
from vision.object_detection.server.http import router as http_router
from vision.object_detection.server.ws import router as ws_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("vision-server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load + warm BEFORE uvicorn starts serving, so /vision/readyz is never
    # 200 with a cold model and /vision/ws refuses connections until warm.
    try:
        engine.load()
    except Exception:
        logger.exception("FAILED to load inference engine on startup!")
        raise
    yield
    logger.info("Shutting down InferenceEngine...")
    engine.close()
    logger.info("Shutdown complete.")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Vision Inference Server",
        description="FastAPI service for local YOLO CUDA object detection",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.include_router(ws_router)
    app.include_router(http_router)

    return app
