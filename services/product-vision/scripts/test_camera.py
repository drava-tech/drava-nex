"""
test_camera.py — Sanity-check script for the camera backend.

Opens the configured camera (RealSense or OpenCV) and displays a live feed
in an OpenCV window. No model is loaded. Use this to verify the camera is
working before you start collecting training data.

Usage:
    cd services/product-vision
    python scripts/test_camera.py

Press Q to quit.
"""

import sys
import os
import logging
import cv2

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)


def main() -> None:
    from config import load_config
    from camera import make_camera

    cfg = load_config()
    log.info("Opening camera backend: %s", cfg.camera_backend)

    with make_camera(cfg) as camera:
        log.info("Camera open. Press Q to quit.")
        while True:
            frame = camera.read_frame()
            if frame is None:
                log.warning("No frame received — waiting…")
                continue

            cv2.imshow("Camera Test — Press Q to quit", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cv2.destroyAllWindows()
    log.info("Done.")


if __name__ == "__main__":
    main()
