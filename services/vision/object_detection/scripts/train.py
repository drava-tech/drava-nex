"""
train.py — YOLOv8 training wrapper for vision.object_detection.

Uses Ultralytics YOLO (pip install ultralytics) to fine-tune a pretrained
YOLOv8n model on your product dataset. YOLOv8n is the smallest/fastest
variant — ideal for a single-class product detector on embedded hardware.

Training output goes to services/vision/object_detection/runs/detect/train/.
The best checkpoint is saved to .../weights/best.pt. Promote it with (from
services/vision/object_detection/):

    cp runs/detect/train/weights/best.pt models/production/smart-glasses-v1.pt

Usage:
    cd services
    python -m vision.object_detection.scripts.train --data vision/object_detection/datasets/smart-glasses-v1/data.yaml

Optional flags:
    --epochs   int    Number of training epochs (default: 100)
    --imgsz    int    Input image size in pixels (default: 640)
    --batch    int    Batch size — reduce if you hit GPU OOM (default: 16)
    --base     str    Pretrained model to start from (default: yolov8n.pt)
    --name     str    Run name inside runs/detect/ (default: train)

Example — quick sanity-check run:
    python -m vision.object_detection.scripts.train --data vision/object_detection/datasets/smart-glasses-v1/data.yaml --epochs 1

Example — full training run:
    python -m vision.object_detection.scripts.train --data vision/object_detection/datasets/smart-glasses-v1/data.yaml --epochs 100
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
        import yaml
    except ImportError:
        log.error("ultralytics is not installed. Run: pip install ultralytics")
        sys.exit(1)

    data_path = Path(args.data).resolve()
    if not data_path.exists():
        log.error("data.yaml not found: %s", data_path)
        sys.exit(1)

    # Project root is services/vision/object_detection
    project_root = Path(__file__).parent.parent

    # data.yaml's `path:` is relative to the monorepo root, but Ultralytics
    # resolves it against its own configured `datasets_dir` (e.g. E:\EC\datasets),
    # producing a wrong path. The dataset root is simply the folder data.yaml
    # lives in, so write a resolved copy with an ABSOLUTE path and train on that.
    # (The committed data.yaml stays portable/relative.)
    data_cfg = yaml.safe_load(data_path.read_text())
    data_cfg["path"] = str(data_path.parent)
    resolved_path = data_path.parent / "data.resolved.yaml"
    resolved_path.write_text(yaml.safe_dump(data_cfg, sort_keys=False))
    log.info("Using resolved dataset config (absolute path): %s", resolved_path)
    data_path = resolved_path

    # Resolve the base weights. If --base is a bare filename that isn't in the
    # current directory, prefer a local copy under models/ so training works
    # OFFLINE (Ultralytics otherwise downloads it from github.com).
    base = args.base
    base_path = Path(base)
    if not base_path.exists() and base_path.parent == Path("."):
        local_base = project_root / "models" / base_path.name
        if local_base.exists():
            base = str(local_base)
            log.info("Using local base weights: %s", base)

    # If the base still doesn't exist on disk, Ultralytics will try to DOWNLOAD it
    # from github.com — which hangs for minutes on a blocked/offline network.
    # Warn up front with offline instructions instead of leaving the user staring
    # at curl timeout spam.
    if not Path(base).exists():
        log.warning(
            "Base weights '%s' not found locally — Ultralytics will try to download it.\n"
            "  If your network blocks github.com you'll see 'curl (28) timeout' and training\n"
            "  will NOT start. To train OFFLINE instead:\n"
            "    1. On any device with internet, download (~6 MB):\n"
            "       https://github.com/ultralytics/assets/releases/download/v8.4.0/%s\n"
            "    2. Copy it to: %s\n"
            "    3. Re-run this exact command (it auto-detects the local file).",
            base, Path(base).name, project_root / "models" / Path(base).name,
        )

    log.info("Loading base model: %s", base)
    try:
        model = YOLO(base)
    except Exception as e:
        log.error("Could not load base weights '%s': %s", base, e)
        log.error(
            "If this is a connection/timeout error, your network is blocking the\n"
            "  download of the pretrained base model from github.com. To train OFFLINE:\n"
            "    1. On any device with internet, download (~6 MB):\n"
            "       https://github.com/ultralytics/assets/releases/download/v8.4.0/%s\n"
            "    2. Copy it to: %s\n"
            "    3. Re-run this exact command (it will auto-detect the local file).\n"
            "  Or, if your office has a proxy:\n"
            "    set HTTPS_PROXY / HTTP_PROXY, then re-run.",
            base_path.name, project_root / "models" / base_path.name,
        )
        sys.exit(1)

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
