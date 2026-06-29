"""
main.py - Entry point for the Product Vision service.

Wires together all modules:
  1. Loads config from .env
  2. Connects to the CMS WebSocket gateway
  3. Loads the YOLOv8 model
  4. Opens the camera, retrying forever if hardware is unavailable
  5. Runs the inference loop:
       frame -> detect -> stability filter -> emit event/status

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
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("main")


def _api_base_from_ws(ws_url: str) -> str:
    """Derive the HTTP API base, e.g. http://192.168.1.250, from the WS URL."""
    base = ws_url.replace("wss://", "https://").replace("ws://", "http://")
    for suffix in ("/ws/", "/ws"):
        if base.endswith(suffix):
            return base[: -len(suffix)]
    return base.rstrip("/")


async def _log_product_for_label(api_base: str, label: str) -> None:
    """Debug only: fetch and print which DB product a detection label maps to."""
    import requests  # bundled in the venv

    url = f"{api_base}/api/products/by-detection-label/{label}"
    try:
        resp = await asyncio.to_thread(requests.get, url, timeout=5)
    except Exception as e:
        log.warning("   product lookup failed (%s): %s", url, e)
        return

    if resp.status_code == 200:
        d = resp.json().get("data", {})
        log.info(
            "   -> product: %r  id=%s  status=%s  [from DB]",
            d.get("name"),
            d.get("productId"),
            d.get("status"),
        )
    elif resp.status_code == 404:
        log.warning(
            "   -> NO active product with detection_label=%r "
            "(create it in the CMS and set status ACTIVE)",
            label,
        )
    else:
        log.warning("   -> lookup HTTP %s for %s", resp.status_code, url)


async def run() -> None:
    from camera import make_camera
    from config import load_config
    from detector import Detector
    from stability import StabilityEvent, StabilityFilter
    from websocket_client import WsClient

    cfg = load_config()
    log.info(
        "Product Vision Service starting (camera: %s, model: %s)",
        cfg.camera_backend,
        cfg.model_path,
    )

    ws = WsClient(cfg)
    await ws.connect()

    detector = Detector(cfg)
    detector.load()

    api_base = _api_base_from_ws(cfg.ws_url)
    active_label: str | None = None
    last_status: str | None = None

    async def publish_status(
        status: str,
        message: str | None = None,
        *,
        force: bool = False,
    ) -> None:
        nonlocal last_status
        if force or status != last_status:
            await ws.send_status(status, message)
            last_status = status

    async def heartbeat_loop() -> None:
        while True:
            await ws.send_heartbeat()
            await asyncio.sleep(5)

    asyncio.create_task(heartbeat_loop())

    camera = None
    stability = StabilityFilter(cfg)
    missed_frames = 0

    while True:
        if camera is None:
            try:
                camera = make_camera(cfg)
                camera.start()
                stability = StabilityFilter(cfg)
                active_label = None
                missed_frames = 0
                log.info("Camera ready. Starting inference loop - press Ctrl+C to stop.")
                await publish_status("waiting", force=True)
            except Exception as e:
                camera = None
                log.warning("Camera unavailable: %s. Retrying in 5s", e)
                await publish_status("camera_unavailable", str(e), force=True)
                await asyncio.sleep(5)
                continue

        frame = camera.read_frame()
        if frame is None:
            missed_frames += 1
            detection = None
            event = stability.update(None)
            if missed_frames >= 60:
                log.warning("Camera stopped returning frames. Reopening in 5s")
                await publish_status("camera_unavailable", "Camera stopped returning frames.", force=True)
                try:
                    camera.stop()
                except Exception:
                    log.warning("Camera stop failed", exc_info=True)
                camera = None
                await asyncio.sleep(5)
                continue
            await asyncio.sleep(0.05)
        else:
            missed_frames = 0
            detection = detector.detect(frame)
            event = stability.update(detection)

        if event == StabilityEvent.PRODUCT_DETECTED and stability.current_detection:
            d = stability.current_detection
            active_label = d.label
            log.info("DETECTED  label=%s  conf=%.2f", d.label, d.confidence)
            await publish_status("detecting")
            await ws.send_detected(d.label, d.confidence)
            if cfg.debug_product_lookup:
                await _log_product_for_label(api_base, d.label)

        elif event == StabilityEvent.PRODUCT_LOST:
            label = active_label or (detection.label if detection else "unknown")
            if cfg.hold_product:
                log.info("LOST  label=%s - holding (VISION_HOLD_PRODUCT=true)", label)
            else:
                log.info("LOST  label=%s", label)
                await ws.send_lost(label)
            active_label = None
            await publish_status("waiting")

        if frame is not None and event == StabilityEvent.NONE and active_label is None:
            await publish_status("waiting")

        await asyncio.sleep(0)


def main() -> None:
    loop = asyncio.new_event_loop()

    def _shutdown(*_) -> None:
        log.info("Shutting down...")
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
