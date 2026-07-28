"""
evaluate.py — Evaluate the trained YOLOv8 model.

Runs validation on the test split to compute mAP50, mAP50-95, precision,
and recall. Saves confusion matrix and PR curves to runs/detect/.

Usage:
    cd services
    python -m vision.object_detection.scripts.evaluate --data vision/object_detection/datasets/smart-glasses-v1/data.yaml
"""

import sys
import os
import argparse
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

def parse_args():
    p = argparse.ArgumentParser(description="Evaluate YOLOv8 model")
    p.add_argument("--data", required=True, help="Path to data.yaml")
    return p.parse_args()

def main():
    args = parse_args()

    try:
        from ultralytics import YOLO  # type: ignore
    except ImportError:
        log.error("ultralytics is not installed. Run: pip install ultralytics")
        sys.exit(1)

    from vision.object_detection.training.config import load_config
    cfg = load_config()

    if not os.path.exists(cfg.model_path):
        log.error("Model not found at %s", cfg.model_path)
        sys.exit(1)

    data_path = Path(args.data).resolve()
    if not data_path.exists():
        log.error("data.yaml not found: %s", data_path)
        sys.exit(1)

    log.info("Loading model: %s", cfg.model_path)
    model = YOLO(cfg.model_path)

    log.info("Evaluating model on test split of %s", data_path)
    
    # Run validation on the test split
    metrics = model.val(data=str(data_path), split='test')
    
    log.info("--- Evaluation Results ---")
    log.info("mAP50:     %.4f", metrics.box.map50)
    log.info("mAP50-95:  %.4f", metrics.box.map)
    
    # Get precision/recall arrays and just log their average or peak
    # (ultralytics metrics returns 1D arrays for P/R across confidence levels)
    # So we'll just refer operator to the PR curve in runs/
    
    log.info("Detailed plots (Confusion Matrix, PR Curve) saved to runs/detect/")

if __name__ == "__main__":
    main()
