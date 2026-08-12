import torch
from fastapi import APIRouter, Response, status
from server.settings import settings
from server.engine import engine

router = APIRouter()

@router.get("/vision/healthz")
async def healthz():
    return {"status": "ok"}

@router.get("/vision/readyz")
async def readyz(response: Response):
    cuda_ok = torch.cuda.is_available()
    if engine.warm and cuda_ok:
        return {
            "status": "ready",
            "modelLoaded": True,
            "cudaAvailable": True,
            "gpuName": torch.cuda.get_device_name(0),
            "inferenceDevice": settings.device
        }
    else:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "not_ready",
            "modelLoaded": engine.warm,
            "cudaAvailable": cuda_ok,
            "gpuName": torch.cuda.get_device_name(0) if cuda_ok else None,
            "inferenceDevice": settings.device
        }

@router.get("/vision/info")
async def info():
    cuda_ok = torch.cuda.is_available()
    avg_inf = 0.0
    if engine.frames_processed > 0:
        avg_inf = engine.total_inference_time_ms / engine.frames_processed

    gpu_mem = {}
    if cuda_ok:
        try:
            gpu_mem = {
                "allocatedBytes": torch.cuda.memory_allocated(0),
                "reservedBytes": torch.cuda.memory_reserved(0)
            }
        except Exception:
            pass

    return {
        "model": {
            "id": settings.model_id,
            "version": settings.model_version,
            "file": settings.model_path.split("/")[-1]
        },
        "inference": {
            "provider": "cuda",
            "device": torch.cuda.get_device_name(0) if cuda_ok else None,
            "cudaAvailable": cuda_ok,
            **gpu_mem
        },
        "metrics": {
            "activeConnections": engine.active_connections,
            "framesProcessed": engine.frames_processed,
            "framesDroppedBusy": engine.frames_dropped_busy,
            "framesDroppedLimit": engine.frames_dropped_limit,
            "avgInferenceTimeMs": avg_inf
        }
    }
