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


def _api_base_from_ws(ws_url: str) -> str:
    """Derive the HTTP API base (e.g. http://192.168.1.250) from the WS gateway URL."""
    base = ws_url.replace("wss://", "https://").replace("ws://", "http://")
    for suffix in ("/ws/", "/ws"):
        if base.endswith(suffix):
            return base[: -len(suffix)]
    return base.rstrip("/")


async def _log_product_for_label(api_base: str, label: str) -> None:
    """Debug only: fetch the product this label maps to and print it locally.

    Calls the CMS API's public detection-label lookup so you can see, right in
    this console, exactly which DB product a detection resolves to.
    """
    import requests  # bundled in the venv

    url = f"{api_base}/api/products/by-detection-label/{label}"
    try:
        resp = await asyncio.to_thread(requests.get, url, timeout=5)
    except Exception as e:
        log.warning("   product lookup failed (%s): %s", url, e)
        return

    if resp.status_code == 200:
        d = resp.json().get("data", {})
        log.info("   -> product: %r  id=%s  status=%s  [from DB]",
                 d.get("name"), d.get("productId"), d.get("status"))
    elif resp.status_code == 404:
        log.warning("   -> NO active product with detection_label=%r "
                    "(create it in the CMS and set status ACTIVE)", label)
    else:
        log.warning("   -> lookup HTTP %s for %s", resp.status_code, url)


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

    api_base = _api_base_from_ws(cfg.ws_url)

    # The label of the product currently shown on the screen. Tracked here so a
    # PRODUCT_LOST carries the correct label (the lost frame itself has none),
    # which is what the gateway matches against to revert the screen.
    active_label: str | None = None

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
                active_label = d.label
                log.info("DETECTED  label=%s  conf=%.2f", d.label, d.confidence)
                await ws.send_detected(d.label, d.confidence)
                if cfg.debug_product_lookup:
                    await _log_product_for_label(api_base, d.label)

            elif event == StabilityEvent.PRODUCT_LOST:
                label = active_label or (detection.label if detection else "unknown")
                if cfg.hold_product:
                    # Keep the product on screen; don't tell the gateway to revert.
                    log.info("LOST  label=%s — holding (VISION_HOLD_PRODUCT=true)", label)
                else:
                    log.info("LOST  label=%s", label)
                    await ws.send_lost(label)
                active_label = None

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
