"""
live_test.py — Live camera test with the trained YOLO model.

Opens the configured camera, runs inference on every frame using the 
promoted model (VISION_MODEL_PATH), and draws bounding boxes on screen.

Usage:
    cd services
    python -m vision.object_detection.scripts.live_test

Press Q to quit.
"""

import sys
import os
import argparse
import time
import logging

import cv2
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

def main():
    try:
        from ultralytics import YOLO  # type: ignore
    except ImportError:
        log.error("ultralytics is not installed. Run: pip install ultralytics")
        sys.exit(1)

    from vision.object_detection.training.config import load_config
    from vision.object_detection.training.camera import make_camera

    cfg = load_config()

    if not os.path.exists(cfg.model_path):
        log.error("Model not found at %s. Have you trained and promoted it?", cfg.model_path)
        sys.exit(1)

    log.info("Loading model: %s", cfg.model_path)
    model = YOLO(cfg.model_path)
    
    log.info("Opening camera backend: %s", cfg.camera_backend)

    with make_camera(cfg) as camera:
        log.info("Camera open. Press Q to quit.")
        
        while True:
            frame = camera.read_frame()
            if frame is None:
                log.warning("No frame received — waiting…")
                time.sleep(0.1)
                continue

            # Run inference
            results = model(frame, verbose=False, conf=cfg.confidence_threshold)
            
            # Plot the results on the frame
            annotated_frame = results[0].plot()

            # Display the annotated frame
            cv2.imshow("Live Test — Press Q to quit", annotated_frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cv2.destroyAllWindows()
    log.info("Done.")

if __name__ == "__main__":
    main()
