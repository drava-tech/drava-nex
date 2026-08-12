"""
pseudo_label.py — Auto-label the remaining images with a trained YOLO model.

Part of the semi-automatic (seed + pseudo-label) workflow:
  1. Hand-label a small seed set         (scripts/label_images.py)
  2. Train a quick model on the seed     (scripts/train.py --name seed)
  3. >>> Pseudo-label the rest <<<        (this script)
  4. Review/fix the drafts               (scripts/label_images.py)
  5. Re-split + train the final model

For every positive image that has NO label yet, this runs the model, writes a
YOLO-format .txt next to the image, and saves an annotated preview JPG into
datasets/<product>/previews/ so you can eyeball the quality before training.

Usage:
    cd services/product-vision
    python scripts/pseudo_label.py --product coster-v1 --model runs/detect/seed/weights/best.pt

Flags:
    --product   Dataset name (required), e.g. coster-v1
    --model     Path to .pt weights (default: newest runs/detect/*/weights/best.pt)
    --conf      Confidence threshold (default 0.25 — seed models are weak)
    --max-det   Max boxes to keep per image (default 1 — one coster per frame)
    --no-previews   Skip writing annotated preview images
    --write-empty   Write an empty .txt (negative) when nothing is detected
"""

import sys
import argparse
import logging
from pathlib import Path

import cv2

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

IMG_EXTS = {".jpg", ".jpeg", ".png"}
CLASS_ID = 0  # single class: coster


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Pseudo-label images with a trained YOLO model")
    p.add_argument("--product", required=True, help="Dataset name, e.g. coster-v1")
    p.add_argument("--model", default=None,
                   help="Path to .pt weights (default: newest runs/detect/*/weights/best.pt)")
    p.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    p.add_argument("--max-det", type=int, default=1, help="Max boxes kept per image")
    p.add_argument("--no-previews", action="store_true", help="Do not write preview images")
    p.add_argument("--write-empty", action="store_true",
                   help="Write empty label (negative) when nothing is detected")
    return p.parse_args()


def find_default_model(project_root: Path) -> Path | None:
    """Pick the most recently modified best.pt under runs/detect/*/weights/."""
    candidates = list(project_root.glob("runs/detect/*/weights/best.pt"))
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def main() -> None:
    args = parse_args()

    try:
        from ultralytics import YOLO  # type: ignore
    except ImportError:
        log.error("ultralytics is not installed. Run: pip install ultralytics")
        sys.exit(1)

    project_root = Path(__file__).parent.parent
    raw_dir = project_root / "datasets" / args.product / "raw" / "positive"
    if not raw_dir.exists():
        log.error("Image directory not found: %s", raw_dir)
        sys.exit(1)

    model_path = Path(args.model) if args.model else find_default_model(project_root)
    if not model_path or not model_path.exists():
        log.error(
            "Model not found%s. Train a seed model first:\n"
            "  python scripts/split_dataset.py --product %s\n"
            "  python scripts/train.py --data datasets/%s/data.yaml --epochs 50 --name seed",
            f" at {model_path}" if model_path else "", args.product, args.product,
        )
        sys.exit(1)

    # Only label images that don't already have a .txt (don't clobber seed/fixed labels)
    images = sorted(p for p in raw_dir.iterdir() if p.suffix.lower() in IMG_EXTS)
    todo = [p for p in images if not p.with_suffix(".txt").exists()]
    if not todo:
        log.info("No unlabeled images left in %s. Nothing to do.", raw_dir)
        return

    log.info("Loading model: %s", model_path)
    model = YOLO(str(model_path))

    previews_dir = project_root / "datasets" / args.product / "previews"
    if not args.no_previews:
        previews_dir.mkdir(parents=True, exist_ok=True)

    log.info("Pseudo-labeling %d unlabeled image(s) (conf=%.2f, max_det=%d)",
             len(todo), args.conf, args.max_det)

    detected, empty = 0, 0
    for img_path in todo:
        img = cv2.imread(str(img_path))
        if img is None:
            log.warning("Could not read %s — skipping", img_path.name)
            continue
        h, w = img.shape[:2]

        results = model(img, conf=args.conf, max_det=args.max_det, verbose=False)
        r = results[0]
        boxes = r.boxes

        lines = []
        if boxes is not None and len(boxes) > 0:
            for box in boxes:
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
                cx = ((x1 + x2) / 2) / w
                cy = ((y1 + y2) / 2) / h
                nw = (x2 - x1) / w
                nh = (y2 - y1) / h
                cx, cy, nw, nh = (min(max(v, 0.0), 1.0) for v in (cx, cy, nw, nh))
                lines.append(f"{CLASS_ID} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}")

        if lines:
            img_path.with_suffix(".txt").write_text("\n".join(lines) + "\n")
            detected += 1
            if not args.no_previews:
                cv2.imwrite(str(previews_dir / f"{img_path.stem}_pred.jpg"), r.plot())
            log.info("%s → %d box(es)", img_path.name, len(lines))
        else:
            empty += 1
            if args.write_empty:
                img_path.with_suffix(".txt").write_text("")
            log.info("%s → no detection%s",
                     img_path.name, " (empty label written)" if args.write_empty else "")

    log.info("Done. %d labeled, %d with no detection.", detected, empty)
    if empty and not args.write_empty:
        log.info("Label the %d missed image(s) by hand: "
                 "python scripts/label_images.py --product %s --only-unlabeled",
                 empty, args.product)
    if not args.no_previews and detected:
        log.info("Review drafts in: %s", previews_dir)
        log.info("Fix any wrong boxes: python scripts/label_images.py --product %s", args.product)


if __name__ == "__main__":
    main()
