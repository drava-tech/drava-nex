"""
main.py — Entry point for the Product Vision service.

Wires together all modules:
  1. Loads config from .env
  2. Opens the camera (RealSense or OpenCV, set by VISION_CAMERA_BACKEND)
  3. Loads the YOLOv8 model
  4. Connects to the CMS WebSocket gateway
  5. Runs the inference loop:
       frame → detect → stability filter → emit event

Stop with Ctrl+C.

Usage:
    cd services/product-vision
    python src/main.py
"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("main")


async def run() -> None:
    from config import load_config
    from camera import make_camera
    from detector import Detector
    from stability import StabilityFilter, StabilityEvent
    from websocket_client import WsClient

    cfg = load_config()
    log.info("Product Vision Service starting (camera: %s, model: %s)", cfg.camera_backend, cfg.model_path)

    detector = Detector(cfg)
    detector.load()

    ws = WsClient(cfg)
    await ws.connect()

    stability = StabilityFilter(cfg)

    with make_camera(cfg) as camera:
        log.info("Camera ready. Starting inference loop — press Ctrl+C to stop.")
        while True:
            frame = camera.read_frame()
            if frame is None:
                await asyncio.sleep(0.01)
                continue

            detection = detector.detect(frame)
            event = stability.update(detection)

            if event == StabilityEvent.PRODUCT_DETECTED and stability.current_detection:
                d = stability.current_detection
                log.info("DETECTED  label=%s  conf=%.2f", d.label, d.confidence)
                await ws.send_detected(d.label, d.confidence)

            elif event == StabilityEvent.PRODUCT_LOST:
                label = detection.label if detection else "unknown"
                log.info("LOST  label=%s", label)
                await ws.send_lost(label)

            # Yield to the event loop so WS keepalive/reconnect tasks can run
            await asyncio.sleep(0)


def main() -> None:
    loop = asyncio.new_event_loop()

    def _shutdown(*_):
        log.info("Shutting down…")
        loop.stop()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    try:
        loop.run_until_complete(run())
    except Exception as e:
        log.error("Fatal error: %s", e, exc_info=True)
        sys.exit(1)
    finally:
        loop.close()


if __name__ == "__main__":
    main()
