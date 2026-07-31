"""
capture_images.py — Capture raw training images from the configured camera.

Enforces a strict budget, sharpness (blur) gating, and perceptual hash (pHash)
deduplication to ensure you only collect high-quality, distinct views of the
product. 

Usage:
    cd services/product-vision
    python scripts/capture_images.py --product smart-glasses-v1 --target positive --count 200
    python scripts/capture_images.py --product smart-glasses-v1 --target background --count 100

Controls (when window is open):
    SPACE  — capture a frame immediately
    Q      — quit
    (frames are also auto-captured every --interval seconds)
"""

import sys
import os
import json
import argparse
import time
import logging
from pathlib import Path
import numpy as np

import cv2

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

def get_sharpness(image: np.ndarray) -> float:
    """Compute Laplacian variance as a measure of sharpness/blur."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return cv2.Laplacian(gray, cv2.CV_64F).var()

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Capture raw training images")
    p.add_argument("--product", required=True, help="Dataset name, e.g. smart-glasses-v1")
    p.add_argument("--target", choices=["positive", "background"], default="positive")
    p.add_argument("--count", type=int, default=200, help="Budget target (if not defined in budget.json)")
    p.add_argument("--interval", type=float, default=0.5, help="Auto-capture interval in seconds")
    p.add_argument("--min-sharpness", type=float, default=100.0, help="Minimum Laplacian variance for a sharp image")
    p.add_argument("--min-diff", type=int, default=10, help="Minimum pHash Hamming distance to count as a new view")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    try:
        from config import load_config
        from camera import make_camera
    except ImportError:
        log.error("Could not import src modules. Are you running inside .venv?")
        sys.exit(1)

    cfg = load_config()
    base_dir = Path(__file__).parent.parent / "datasets" / args.product
    out_dir = base_dir / "raw" / args.target
    out_dir.mkdir(parents=True, exist_ok=True)

    # Load budget if exists
    budget_file = base_dir / "budget.json"
    target_count = args.count
    if budget_file.exists():
        try:
            budget_data = json.loads(budget_file.read_text())
            if args.target in budget_data:
                target_count = int(budget_data[args.target])
                log.info("Loaded budget for %s from budget.json: %d", args.target, target_count)
        except Exception as e:
            log.warning("Failed to parse budget.json: %s", e)

    existing_images = list(out_dir.glob("*.jpg"))
    existing_count = len(existing_images)
    
    if existing_count >= target_count:
        log.info("Target budget of %d images already reached (%d existing). Exiting.", target_count, existing_count)
        sys.exit(0)

    log.info("Saving to: %s", out_dir)
    log.info("Budget: %d | Currently have: %d | Need: %d more", target_count, existing_count, target_count - existing_count)

    # Pre-calculate hashes for existing images to avoid duplicates across sessions
    kept_hashes = []
    log.info("Hashing %d existing images...", existing_count)
    for img_path in existing_images:
        img = cv2.imread(str(img_path))
        if img is not None:
            kept_hashes.append(phash(img))

    with make_camera(cfg) as camera:
        last_auto = time.monotonic()
        count = existing_count
        
        while count < target_count:
            frame = camera.read_frame()
            if frame is None:
                continue

            now = time.monotonic()
            auto_capture = (now - last_auto) >= args.interval
            
            key = cv2.waitKey(1) & 0xFF
            capture_now = (key == ord(" ")) or auto_capture

            display = frame.copy()
            hud_text = f"{args.target.upper()}  {count}/{target_count}  (SPACE=cap, Q=quit)"
            hud_color = (0, 255, 0)
            
            # Gating checks
            sharpness = get_sharpness(frame)
            current_hash = phash(frame)
            
            is_blurry = sharpness < args.min_sharpness
            is_dup = False
            
            if not is_blurry:
                for kh in kept_hashes:
                    if hamming_distance(current_hash, kh) < args.min_diff:
                        is_dup = True
                        break

            if is_blurry:
                hud_text = f"TOO BLURRY! ({sharpness:.0f} < {args.min_sharpness})"
                hud_color = (0, 0, 255)
            elif is_dup:
                hud_text = "TOO SIMILAR! Change angle/dist."
                hud_color = (0, 165, 255) # Orange

            cv2.putText(
                display,
                hud_text,
                (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, hud_color, 2,
            )
            cv2.putText(
                display,
                f"Sharpness: {sharpness:.0f}",
                (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1,
            )
            cv2.imshow("Capture", display)

            if capture_now:
                # Only capture if it passes the gates
                if not is_blurry and not is_dup:
                    # Find next available index
                    idx = count
                    while (out_dir / f"{args.target}_{idx:04d}.jpg").exists():
                        idx += 1
                        
                    filename = out_dir / f"{args.target}_{idx:04d}.jpg"
                    cv2.imwrite(str(filename), frame)
                    kept_hashes.append(current_hash)
                    count += 1
                    log.info("Saved %s (%d/%d)", filename.name, count, target_count)
                else:
                    if auto_capture:
                        # Silently skip if auto-capturing bad frames
                        pass
                    else:
                        log.warning("Manual capture skipped (Blurry: %s, Dup: %s)", is_blurry, is_dup)
                last_auto = now

            if key == ord("q"):
                log.info("Quit early — captured %d images this session.", count - existing_count)
                break

    cv2.destroyAllWindows()
    log.info("Done. Total distinct images in %s: %d", args.target, count)
    
    if count >= target_count:
        log.info("Target budget of %d reached!", target_count)


if __name__ == "__main__":
    main()
