"""
split_dataset.py — Split annotated images into train / val / test sets.

Expects images in datasets/<product>/raw/positive/ and their YOLO label files
(*.txt) alongside them. Splits by 70 / 15 / 15 and copies files into:

    datasets/<product>/images/train|val|test/
    datasets/<product>/labels/train|val|test/

Run this AFTER you have annotated your images with a tool like LabelImg or
Roboflow and exported in YOLO format (one .txt per image alongside it).

Usage:
    cd services/product-vision
    python scripts/split_dataset.py --product smart-glasses-v1

Notes:
  - Images without a matching .txt label file are skipped.
  - Run again to re-split; output dirs are cleared first.
  - Background images (no labels) are not included — YOLO handles negatives
    via empty label files if needed; add them manually after splitting.
"""

import sys
import os

import argparse
import random
import shutil
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SPLITS = {"train": 0.70, "val": 0.15, "test": 0.15}
IMG_EXTS = {".jpg", ".jpeg", ".png"}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Split annotated dataset into train/val/test")
    p.add_argument("--product", required=True, help="Dataset name, e.g. smart-glasses-v1")
    p.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    root = Path(__file__).parent.parent / "datasets" / args.product

    raw_dir = root / "raw" / "positive"
    if not raw_dir.exists():
        log.error("raw/positive directory not found: %s", raw_dir)
        sys.exit(1)

    # Collect paired (image, label) files
    pairs: list[tuple[Path, Path]] = []
    for img_path in sorted(raw_dir.iterdir()):
        if img_path.suffix.lower() not in IMG_EXTS:
            continue
        label_path = img_path.with_suffix(".txt")
        if not label_path.exists():
            log.warning("Skipping %s — no matching .txt label file", img_path.name)
            continue
        pairs.append((img_path, label_path))

    if not pairs:
        log.error(
            "No annotated images found in %s. "
            "Annotate your images first (LabelImg or Roboflow) and export as YOLO format.",
            raw_dir,
        )
        sys.exit(1)

    log.info("Found %d annotated images. Splitting…", len(pairs))
    random.seed(args.seed)
    random.shuffle(pairs)

    n_total = len(pairs)
    n_train = int(n_total * SPLITS["train"])
    n_val = int(n_total * SPLITS["val"])

    split_map = {
        "train": pairs[:n_train],
        "val": pairs[n_train: n_train + n_val],
        "test": pairs[n_train + n_val:],
    }

    for split, items in split_map.items():
        img_out = root / "images" / split
        lbl_out = root / "labels" / split
        # Clear and recreate
        shutil.rmtree(img_out, ignore_errors=True)
        shutil.rmtree(lbl_out, ignore_errors=True)
        img_out.mkdir(parents=True)
        lbl_out.mkdir(parents=True)

        for img_path, label_path in items:
            shutil.copy2(img_path, img_out / img_path.name)
            shutil.copy2(label_path, lbl_out / label_path.stem + ".txt")

        log.info("  %s: %d images", split, len(items))

    log.info("Split complete. data.yaml is at %s", root / "data.yaml")


if __name__ == "__main__":
    main()
