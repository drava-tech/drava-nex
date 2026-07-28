"""
trim_dataset.py — Enforce an exact image budget per product.

Counts images in datasets/<product>/raw/<target>/ and deletes any surplus
beyond the budget. Can also perform near-duplicate removal (pHash) on the
remaining images to ensure diversity.

Usage:
    cd services
    python -m vision.object_detection.scripts.trim_dataset --product smart-glasses-v1 --positive 200 --background 100
    # or to just do a dry run:
    python -m vision.object_detection.scripts.trim_dataset --product smart-glasses-v1 --positive 200 --dry-run
"""

import argparse
import logging
import os
from pathlib import Path
import cv2
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

def phash(image: np.ndarray, hash_size: int = 8) -> np.ndarray:
    """Compute a simple perceptual hash (pHash) of an image."""
    resized = cv2.resize(image, (hash_size + 1, hash_size))
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    diff = gray[:, 1:] > gray[:, :-1]
    return diff.flatten()

def hamming_distance(hash1: np.ndarray, hash2: np.ndarray) -> int:
    return int(np.count_nonzero(hash1 != hash2))

def parse_args():
    p = argparse.ArgumentParser(description="Enforce image budget per product")
    p.add_argument("--product", required=True, help="Dataset name, e.g. smart-glasses-v1")
    p.add_argument("--positive", type=int, help="Budget for positive images")
    p.add_argument("--background", type=int, help="Budget for background images")
    p.add_argument("--keep", choices=["newest", "oldest"], default="newest", help="Which to keep when trimming surplus")
    p.add_argument("--dry-run", action="store_true", help="Preview deletions without modifying files")
    p.add_argument("--dedup", action="store_true", help="Remove near-duplicates before trimming to budget")
    p.add_argument("--min-diff", type=int, default=10, help="Minimum pHash Hamming distance for dedup (default: 10)")
    return p.parse_args()

def trim_directory(dir_path: Path, budget: int, keep: str, is_dry_run: bool, dedup: bool, min_diff: int):
    if not dir_path.exists():
        log.warning("Directory not found: %s", dir_path)
        return

    images = list(dir_path.glob("*.jpg"))
    if not images:
        log.info("%s: Empty.", dir_path.name)
        return

    # Sort images by modification time
    images.sort(key=lambda p: p.stat().st_mtime)

    removed = 0

    if dedup:
        log.info("Running dedup pass on %s...", dir_path.name)
        kept_hashes = []
        kept_images = []
        for img_path in images:
            img = cv2.imread(str(img_path))
            if img is None:
                continue
            h = phash(img)
            
            is_dup = False
            for kh in kept_hashes:
                if hamming_distance(h, kh) < min_diff:
                    is_dup = True
                    break
            
            if is_dup:
                log.info("Duplicate found: %s", img_path.name)
                if not is_dry_run:
                    img_path.unlink()
                removed += 1
            else:
                kept_hashes.append(h)
                kept_images.append(img_path)
        images = kept_images
        log.info("Dedup removed %d images from %s", removed, dir_path.name)

    surplus = len(images) - budget
    if surplus <= 0:
        log.info("%s: Under/at budget (%d <= %d). No trim needed.", dir_path.name, len(images), budget)
        return

    log.info("%s: Over budget by %d images (%d > %d).", dir_path.name, surplus, len(images), budget)
    
    # Determine which to delete based on --keep
    if keep == "newest":
        to_delete = images[:surplus]  # Delete oldest
    else:
        to_delete = images[-surplus:] # Delete newest

    for p in to_delete:
        if is_dry_run:
            log.info("[DRY RUN] Would delete %s", p.name)
        else:
            p.unlink()
            log.debug("Deleted %s", p.name)
    
    log.info("%s: Trimmed %d images. Now at budget %d.", dir_path.name, surplus, budget)

def main():
    args = parse_args()

    base_dir = Path(__file__).parent.parent / "datasets" / args.product / "raw"
    
    if args.positive is not None:
        trim_directory(base_dir / "positive", args.positive, args.keep, args.dry_run, args.dedup, args.min_diff)
        
    if args.background is not None:
        trim_directory(base_dir / "background", args.background, args.keep, args.dry_run, args.dedup, args.min_diff)

if __name__ == "__main__":
    main()
