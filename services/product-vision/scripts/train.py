"""
train.py — YOLOv8 training wrapper for the Product Vision service.

Uses Ultralytics YOLO (pip install ultralytics) to fine-tune a pretrained
YOLOv8n model on your product dataset. YOLOv8n is the smallest/fastest
variant — ideal for a single-class product detector on embedded hardware.

Training output goes to runs/detect/train/. The best checkpoint is saved to
runs/detect/train/weights/best.pt. Promote it to production with:

    cp runs/detect/train/weights/best.pt models/production/smart-glasses-v1.pt

Usage:
    cd services/product-vision
    python scripts/train.py --data datasets/smart-glasses-v1/data.yaml

Optional flags:
    --epochs   int    Number of training epochs (default: 100)
    --imgsz    int    Input image size in pixels (default: 640)
    --batch    int    Batch size — reduce if you hit GPU OOM (default: 16)
    --base     str    Pretrained model to start from (default: yolov8n.pt)
    --name     str    Run name inside runs/detect/ (default: train)

Example — quick sanity-check run:
    python scripts/train.py --data datasets/smart-glasses-v1/data.yaml --epochs 1

Example — full training run:
    python scripts/train.py --data datasets/smart-glasses-v1/data.yaml --epochs 100
"""

import sys
import os

import argparse
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train a YOLOv8 product detector")
    p.add_argument("--data", required=True, help="Path to data.yaml")
    p.add_argument("--epochs", type=int, default=100)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--base", default="yolov8n.pt", help="Pretrained weights to start from")
    p.add_argument("--name", default="train", help="Run directory name inside runs/detect/")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    try:
        from ultralytics import YOLO  # type: ignore
    except ImportError:
        log.error("ultralytics is not installed. Run: pip install ultralytics")
        sys.exit(1)

    data_path = Path(args.data).resolve()
    if not data_path.exists():
        log.error("data.yaml not found: %s", data_path)
        sys.exit(1)

    # Project root is services/product-vision
    project_root = Path(__file__).parent.parent

    log.info("Loading base model: %s", args.base)
    model = YOLO(args.base)

    log.info(
        "Starting training — data=%s  epochs=%d  imgsz=%d  batch=%d",
        data_path, args.epochs, args.imgsz, args.batch,
    )

    model.train(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=str(project_root / "runs" / "detect"),
        name=args.name,
        exist_ok=True,
    )

    best = project_root / "runs" / "detect" / args.name / "weights" / "best.pt"
    if best.exists():
        log.info("Training complete!")
        log.info("Best model: %s", best)
        log.info("Promote to production:")
        log.info(
            "  copy %s models\\production\\smart-glasses-v1.pt",
            best.relative_to(project_root),
        )
    else:
        log.warning("Training finished but best.pt not found at expected path: %s", best)


if __name__ == "__main__":
    main()
