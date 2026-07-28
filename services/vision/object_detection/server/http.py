from fastapi import APIRouter, Response, status

from vision.object_detection.server.engine import engine
from vision.object_detection.server.runtime import cuda_available, gpu_memory, gpu_name
from vision.object_detection.server.settings import settings

router = APIRouter()


@router.get("/vision/healthz")
async def healthz():
    """Liveness only — the process is up. Says nothing about the model."""
    return {"status": "ok"}


@router.get("/vision/readyz")
async def readyz(response: Response):
    """Readiness — 200 only once the model is loaded AND warmed on a CUDA device."""
    cuda_ok = cuda_available()
    if engine.warm and cuda_ok:
        return {
            "status": "ready",
            "modelLoaded": True,
            "cudaAvailable": True,
            "gpuName": gpu_name(),
            "inferenceDevice": settings.device,
        }

    response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "not_ready",
        "modelLoaded": engine.warm,
        "cudaAvailable": cuda_ok,
        "gpuName": gpu_name(),
        "inferenceDevice": settings.device,
    }


@router.get("/vision/info")
async def info():
    cuda_ok = cuda_available()
    avg_inf = 0.0
    if engine.frames_processed > 0:
        avg_inf = engine.total_inference_time_ms / engine.frames_processed

    return {
        "model": {
            "id": settings.model_id,
            "version": settings.model_version,
            "file": settings.model_file,
        },
        "inference": {
            "provider": "cuda",
            "device": gpu_name(),
            "cudaAvailable": cuda_ok,
            **gpu_memory(),
        },
        "metrics": {
            "activeConnections": engine.active_connections,
            "framesProcessed": engine.frames_processed,
            "framesDroppedBusy": engine.frames_dropped_busy,
            "framesDroppedLimit": engine.frames_dropped_limit,
            "avgInferenceTimeMs": avg_inf,
        },
    }
