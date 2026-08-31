import asyncio
import time
from datetime import datetime
import logging
import torch
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from server.settings import settings
from server.engine import engine
from server.protocol import unpack_frame, DetectionsMessage, ModelInfo, InferenceInfo, SourceInfo, DetectionResult

logger = logging.getLogger("vision-server")

router = APIRouter()

@router.websocket("/vision/ws")
async def vision_ws_endpoint(websocket: WebSocket):
    if not engine.warm:
        logger.warning("Connection rejected: InferenceEngine not ready.")
        await websocket.close(code=1013, reason="Engine not ready")
        return

    if engine.active_connections >= settings.max_connections:
        logger.warning(f"Connection rejected: Max connections reached ({settings.max_connections}).")
        await websocket.close(code=1013, reason="Capacity exceeded")
        return

    # Accept connection
    await websocket.accept()
    engine.active_connections += 1
    logger.info(f"Client connected. Active connections: {engine.active_connections}")

    # Send ready message
    ready_msg = {
        "type": "ready",
        "model": {
            "id": settings.model_id,
            "version": settings.model_version,
            "file": settings.model_path.split("/")[-1]
        },
        "limits": {
            "maxFrameBytes": settings.max_frame_bytes,
            "minFrameIntervalMs": settings.min_frame_interval_ms
        }
    }
    await websocket.send_json(ready_msg)

    last_frame_time = 0.0
    busy = False

    try:
        while True:
            data = await websocket.receive_bytes()
            
            # 1. Enforce physical frame size limits (close if > 2x max size)
            if len(data) > settings.max_frame_bytes * 2:
                logger.warning(f"Closing connection: Frame size {len(data)} exceeds hard limit.")
                await websocket.close(code=1009, reason="Message too large")
                break

            # Parse frame header first
            try:
                frame_type, frame_id, payload = unpack_frame(data)
            except Exception as e:
                logger.warning(f"Bad frame format: {e}")
                await websocket.send_json({
                    "type": "error",
                    "code": "BAD_FRAME",
                    "message": "Failed to parse 9-byte header protocol"
                })
                continue

            # 2. Check frame size soft limit
            if len(payload) > settings.max_frame_bytes:
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "FRAME_TOO_LARGE",
                    "message": f"Frame payload exceeds {settings.max_frame_bytes} bytes"
                })
                continue

            # 3. Rate limiting (min interval between frames)
            now = time.perf_counter()
            interval_ms = (now - last_frame_time) * 1000.0
            if last_frame_time > 0 and interval_ms < settings.min_frame_interval_ms:
                engine.frames_dropped_limit += 1
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "RATE_LIMITED",
                    "message": f"Rate limit exceeded. Minimum interval is {settings.min_frame_interval_ms}ms"
                })
                continue

            # 4. One-in-flight enforcement (BUSY flag)
            if busy:
                engine.frames_dropped_busy += 1
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "BUSY",
                    "message": "Inference in progress"
                })
                continue

            # 5. Unsupported frame type
            if frame_type != 0x01:
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "BAD_FRAME",
                    "message": f"Unsupported frame type: {frame_type:#x}"
                })
                continue

            last_frame_time = now
            busy = True

            # Perform inference with timeout
            try:
                timeout_sec = settings.inference_timeout_ms / 1000.0
                
                async def run_infer():
                    return await engine.infer(payload)
                
                detections, processing_time_ms, source_dims = await asyncio.wait_for(
                    run_infer(),
                    timeout=timeout_sec
                )

                # Send success detections back to client
                response = DetectionsMessage(
                    frameId=frame_id,
                    timestamp=datetime.utcnow().isoformat() + "Z",
                    model=ModelInfo(
                        id=settings.model_id,
                        version=settings.model_version,
                        file=settings.model_path.split("/")[-1]
                    ),
                    inference=InferenceInfo(
                        provider="cuda",
                        device=torch.cuda.get_device_name(0),
                        processingTimeMs=processing_time_ms
                    ),
                    source=SourceInfo(
                        width=source_dims["width"],
                        height=source_dims["height"]
                    ),
                    detections=[
                        DetectionResult(
                            classId=d["classId"],
                            label=d["label"],
                            confidence=d["confidence"],
                            box=d["box"]
                        ) for d in detections
                    ]
                )
                await websocket.send_json(response.model_dump())

            except asyncio.TimeoutError:
                logger.error(f"Inference timeout for frameId={frame_id}")
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "INFERENCE_TIMEOUT",
                    "message": "Inference timed out"
                })
            except ValueError as ve:
                logger.warning(f"Invalid image bytes for frameId={frame_id}: {ve}")
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "BAD_FRAME",
                    "message": "Invalid JPEG payload"
                })
            except Exception as e:
                logger.exception(f"Inference error for frameId={frame_id}: {e}")
                await websocket.send_json({
                    "type": "error",
                    "frameId": frame_id,
                    "code": "INTERNAL",
                    "message": f"Internal inference error: {e}"
                })
            finally:
                busy = False

    except WebSocketDisconnect:
        logger.info("Client disconnected normally.")
    except Exception as e:
        logger.error(f"WebSocket connection error: {e}")
    finally:
        engine.active_connections -= 1
        logger.info(f"Connection cleaned up. Active connections: {engine.active_connections}")
