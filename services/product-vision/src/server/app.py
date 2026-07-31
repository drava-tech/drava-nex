from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI
from server.engine import engine
from server.ws import router as ws_router
from server.http import router as http_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("vision-server")

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        engine.load()
    except Exception as e:
        logger.exception("FAILED to load inference engine on startup!")
        raise e
    yield
    logger.info("Shutting down InferenceEngine...")
    engine.close()
    logger.info("Shutdown complete.")

def create_app() -> FastAPI:
    app = FastAPI(
        title="Vision Inference Server",
        description="FastAPI service for local YOLO CUDA object detection",
        version="1.0.0",
        lifespan=lifespan
    )

    app.include_router(ws_router)
    app.include_router(http_router)

    return app
