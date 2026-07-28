import asyncio
import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from vision.object_detection.server.engine import engine
from vision.object_detection.server.protocol import (
    DetectionResult,
    DetectionsMessage,
    InferenceInfo,
    ModelInfo,
    SourceInfo,
    unpack_frame,
)
from vision.object_detection.server.runtime import gpu_name
from vision.object_detection.server.settings import settings

logger = logging.getLogger("vision-server")

router = APIRouter()

_FRAME_TYPE_JPEG = 0x01


def _model_info() -> ModelInfo:
    return ModelInfo(
        id=settings.model_id,
        version=settings.model_version,
        file=settings.model_file,
    )


@router.websocket("/vision/ws")
async def vision_ws_endpoint(websocket: WebSocket):
    if not engine.warm:
        logger.warning("Connection rejected: InferenceEngine not ready.")
        await websocket.close(code=1013, reason="Engine not ready")
        return

    if engine.active_connections >= settings.max_connections:
        logger.warning(
            "Connection rejected: Max connections reached (%d).", settings.max_connections
        )
        await websocket.close(code=1013, reason="Capacity exceeded")
        return

    await websocket.accept()
    engine.active_connections += 1
    logger.info("Client connected. Active connections: %d", engine.active_connections)

    # `ready` handshake — ServerDetectionClient treats this as "server usable"
    # and useServerDetection reports CAMERA_STATUS=waiting off the back of it.
    await websocket.send_json({
        "type": "ready",
        "model": _model_info().model_dump(),
        "limits": {
            "maxFrameBytes": settings.max_frame_bytes,
            "minFrameIntervalMs": settings.min_frame_interval_ms,
        },
    })

    last_frame_time = 0.0
    busy = False

    try:
        while True:
            data = await websocket.receive_bytes()

            # 1. Hard size ceiling — a client this far out of spec gets closed,
            #    not error-framed (2x the advertised cap).
            if len(data) > settings.max_frame_bytes * 2:
                logger.warning("Closing connection: Frame size %d exceeds hard limit.", len(data))
                await websocket.close(code=1009, reason="Message too large")
                break

            # Parse the 9-byte header first so errors can carry the frameId.
            try:
                frame_type, frame_id, payload = unpack_frame(data)
            except Exception as e:
                logger.warning("Bad frame format: %s", e)
                await websocket.send_json({
                    "type": "error",
                    "code": "BAD_FRAME",
                    "message": "Failed to parse 9-byte header protocol",
                })
                continue

            # 2. Soft payload cap
            if len(payload) > settings.max_frame_bytes:
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "FRAME_TOO_LARGE",
                    "message": f"Frame payload exceeds {settings.max_frame_bytes} bytes",
                })
                continue

            # 3. Rate limit — floor on the interval between accepted frames.
            now = time.perf_counter()
            interval_ms = (now - last_frame_time) * 1000.0
            if last_frame_time > 0 and interval_ms < settings.min_frame_interval_ms:
                engine.frames_dropped_limit += 1
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "RATE_LIMITED",
                    "message": (
                        f"Rate limit exceeded. Minimum interval is "
                        f"{settings.min_frame_interval_ms}ms"
                    ),
                })
                continue

            # 4. One inference in flight per connection.
            if busy:
                engine.frames_dropped_busy += 1
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "BUSY",
                    "message": "Inference in progress",
                })
                continue

            # 5. Unsupported frame type
            if frame_type != _FRAME_TYPE_JPEG:
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "BAD_FRAME",
                    "message": f"Unsupported frame type: {frame_type:#x}",
                })
                continue

            last_frame_time = now
            busy = True

            try:
                timeout_sec = settings.inference_timeout_ms / 1000.0
                detections, processing_time_ms, source_dims = await asyncio.wait_for(
                    engine.infer(payload), timeout=timeout_sec
                )

                response = DetectionsMessage(
                    frameId=frame_id,
                    timestamp=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    model=_model_info(),
                    inference=InferenceInfo(
                        provider="cuda",
                        device=gpu_name() or settings.device,
                        processingTimeMs=processing_time_ms,
                    ),
                    source=SourceInfo(
                        width=source_dims["width"],
                        height=source_dims["height"],
                    ),
                    detections=[
                        DetectionResult(
                            classId=d["classId"],
                            label=d["label"],
                            confidence=d["confidence"],
                            box=d["box"],
                        )
                        for d in detections
                    ],
                )
                await websocket.send_json(response.model_dump())

            except asyncio.TimeoutError:
                logger.error("Inference timeout for frameId=%s", frame_id)
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "INFERENCE_TIMEOUT",
                    "message": "Inference timed out",
                })
            except ValueError as ve:
                logger.warning("Invalid image bytes for frameId=%s: %s", frame_id, ve)
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "BAD_FRAME",
                    "message": "Invalid JPEG payload",
                })
            except Exception as e:
                logger.exception("Inference error for frameId=%s: %s", frame_id, e)
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "INTERNAL",
                    "message": f"Internal inference error: {e}",
                })
            finally:
                busy = False

    except WebSocketDisconnect:
        logger.info("Client disconnected normally.")
    except Exception as e:
        logger.error("WebSocket connection error: %s", e)
    finally:
        engine.active_connections -= 1
        logger.info("Connection cleaned up. Active connections: %d", engine.active_connections)
