"""
export.py — Export the YOLOv8 model to ONNX.

Useful for deploying to edge devices (e.g., Jetson Nano, Coral, or just faster CPU inference).

Usage:
    cd services/product-vision
    python scripts/export.py --format onnx
"""

import sys
import os
import argparse
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

def parse_args():
    p = argparse.ArgumentParser(description="Export YOLOv8 model")
    p.add_argument("--format", default="onnx", help="Export format (onnx, engine, tflite, etc.)")
    p.add_argument("--imgsz", type=int, default=640, help="Image size")
    return p.parse_args()

def main():
    args = parse_args()

    try:
        from ultralytics import YOLO  # type: ignore
    except ImportError:
        log.error("ultralytics is not installed. Run: pip install ultralytics")
        sys.exit(1)

    from config import load_config
    cfg = load_config()

    if not os.path.exists(cfg.model_path):
        log.error("Model not found at %s", cfg.model_path)
        sys.exit(1)

    log.info("Loading model: %s", cfg.model_path)
    model = YOLO(cfg.model_path)

    log.info("Exporting to %s format (imgsz=%d)...", args.format, args.imgsz)
    
    exported_path = model.export(format=args.format, imgsz=args.imgsz)
    
    log.info("Successfully exported to: %s", exported_path)
    log.info("Update VISION_MODEL_PATH in .env to use the exported model.")

if __name__ == "__main__":
    main()
