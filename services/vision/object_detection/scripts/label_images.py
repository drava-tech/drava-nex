"""
label_images.py — Minimal OpenCV bounding-box labeler (no external tool needed).

Single-class labeling for the Product Vision datasets. Draw one or more boxes
around the object with the mouse, press ENTER, and a YOLO-format .txt file is
written next to each image. Because it also draws any EXISTING boxes when it
opens an image, this same tool doubles as a review/fix tool for pseudo-labels.

Output format (one line per box, values normalized 0–1):
    <class_id> <x_center> <y_center> <width> <height>

The class id is always 0 (the single product class, e.g. "coster"). For a
multi-class dataset later, extend with a --class flag.

Usage:
    cd services

    # Label the first 20 positive images as the seed set:
    python -m vision.object_detection.scripts.label_images --product coster-v1 --limit 20

    # Review/fix everything (shows existing boxes so you can redo bad ones):
    python -m vision.object_detection.scripts.label_images --product coster-v1

    # Only touch images that have no label yet:
    python -m vision.object_detection.scripts.label_images --product coster-v1 --only-unlabeled

Controls (per image):
    Drag a box, then press ENTER/SPACE to confirm it. Draw several if needed.
    Press ESC to finish the image — boxes are then saved automatically and the
    NEXT image opens (you don't press anything else to advance).

Global keys (in the preview window between images):
    n / ENTER  — save current image's boxes and go to next
    s          — skip (leave this image's existing label untouched)
    d          — delete this image's label file
    b          — go back to the previous image
    q / ESC    — quit
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
WINDOW = "label — drag box, ENTER to add; finish with empty ENTER"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Minimal OpenCV single-class labeler")
    p.add_argument("--product", required=True, help="Dataset name, e.g. coster-v1")
    p.add_argument("--target", choices=["positive", "background"], default="positive")
    p.add_argument("--only-unlabeled", action="store_true",
                   help="Skip images that already have a .txt label")
    p.add_argument("--limit", type=int, default=0,
                   help="Label at most N images this run (0 = no limit)")
    p.add_argument("--reset", action="store_true",
                   help="ERASE all existing .txt labels in this target before starting (clean redo)")
    return p.parse_args()


def yolo_lines_to_boxes(text: str, w: int, h: int) -> list[tuple[int, int, int, int]]:
    """Parse a YOLO label file into pixel (x, y, bw, bh) boxes for display."""
    boxes = []
    for line in text.strip().splitlines():
        parts = line.split()
        if len(parts) != 5:
            continue
        _, cx, cy, bw, bh = parts
        cx, cy, bw, bh = float(cx), float(cy), float(bw), float(bh)
        px, py = (cx - bw / 2) * w, (cy - bh / 2) * h
        boxes.append((int(px), int(py), int(bw * w), int(bh * h)))
    return boxes


def boxes_to_yolo(boxes: list[tuple[int, int, int, int]], w: int, h: int) -> str:
    """Convert pixel (x, y, bw, bh) boxes to YOLO-format text (class 0)."""
    lines = []
    for (x, y, bw, bh) in boxes:
        if bw <= 0 or bh <= 0:
            continue
        cx = (x + bw / 2) / w
        cy = (y + bh / 2) / h
        nw = bw / w
        nh = bh / h
        # clamp to [0, 1] so a slightly out-of-frame drag stays valid
        cx, cy, nw, nh = (min(max(v, 0.0), 1.0) for v in (cx, cy, nw, nh))
        lines.append(f"{CLASS_ID} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}")
    return "\n".join(lines)


def main() -> None:
    args = parse_args()

    raw_dir = Path(__file__).parent.parent / "datasets" / args.product / "raw" / args.target
    if not raw_dir.exists():
        log.error("Image directory not found: %s\nCapture images first with capture_images.py.",
                  raw_dir)
        sys.exit(1)

    images = sorted(p for p in raw_dir.iterdir() if p.suffix.lower() in IMG_EXTS)
    if not images:
        log.error("No images found in %s", raw_dir)
        sys.exit(1)

    # --reset: wipe every existing label so you can start the labeling over.
    if args.reset:
        existing_labels = list(raw_dir.glob("*.txt"))
        for lbl in existing_labels:
            lbl.unlink()
        log.warning("RESET: erased %d existing label file(s) in %s", len(existing_labels), raw_dir)

    log.info("Labels are saved as .txt next to each image in: %s", raw_dir)

    if args.only_unlabeled:
        images = [p for p in images if not p.with_suffix(".txt").exists()]
        if not images:
            log.info("All images already labeled. Nothing to do.")
            return

    if args.limit > 0:
        images = images[: args.limit]

    log.info("Labeling %d image(s) from %s", len(images), raw_dir)
    log.info("For each image: drag a box, ENTER/SPACE to confirm, then ESC to save & go to next.")

    cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)
    labeled = 0
    i = 0
    while 0 <= i < len(images):
        img_path = images[i]
        img = cv2.imread(str(img_path))
        if img is None:
            log.warning("Could not read %s — skipping", img_path.name)
            i += 1
            continue

        h, w = img.shape[:2]
        label_path = img_path.with_suffix(".txt")

        # Show existing boxes (review/fix mode)
        existing = []
        if label_path.exists():
            existing = yolo_lines_to_boxes(label_path.read_text(), w, h)

        preview = img.copy()
        for (x, y, bw, bh) in existing:
            cv2.rectangle(preview, (x, y), (x + bw, y + bh), (0, 255, 0), 2)
        status = "labeled" if label_path.exists() else "UNLABELED"
        cv2.putText(preview, f"[{i + 1}/{len(images)}] {img_path.name}  ({status})",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        cv2.putText(preview, "ENTER/n=relabel  s=skip  d=delete  b=back  q=quit",
                    (10, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
        cv2.imshow(WINDOW, preview)
        key = cv2.waitKey(0) & 0xFF

        if key in (ord("q"), 27):  # q / ESC
            log.info("Quit. Labeled %d image(s) this run.", labeled)
            break
        if key == ord("s"):
            i += 1
            continue
        if key == ord("b"):
            i = max(0, i - 1)
            continue
        if key == ord("d"):
            if label_path.exists():
                label_path.unlink()
                log.info("Deleted label for %s", img_path.name)
            i += 1
            continue

        # ENTER / n / SPACE → (re)draw boxes for this image
        rois = cv2.selectROIs(WINDOW, img, showCrosshair=True, fromCenter=False)
        # selectROIs returns an (N,4) array or empty tuple; normalize to list
        boxes = [tuple(int(v) for v in r) for r in rois] if len(rois) else []

        if not boxes:
            # Empty selection: for background target this means a valid negative
            # (empty file); for positive, treat as "no change" unless none existed.
            if args.target == "background":
                label_path.write_text("")
                log.info("LABELED IMAGE SAVED (negative) -> %s", label_path)
                labeled += 1
            else:
                log.info("%s -> no box drawn; left unchanged", img_path.name)
            i += 1
            continue

        label_path.write_text(boxes_to_yolo(boxes, w, h) + "\n")
        log.info("LABELED IMAGE SAVED (%d box) -> %s", len(boxes), label_path)
        labeled += 1
        i += 1

    cv2.destroyAllWindows()
    log.info("Done. %d image(s) labeled/updated.", labeled)
    log.info("All labels are stored here: %s", raw_dir)


if __name__ == "__main__":
    main()
