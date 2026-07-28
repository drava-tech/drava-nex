"""
split_dataset.py — Split annotated images into train / val / test sets.

Reads BOTH source folders under datasets/<product>/raw/:

  raw/positive/    images + their YOLO .txt label files (one per image)
  raw/background/  true negatives — no product in frame, no label file needed

and copies them into:

    datasets/<product>/images/train|val|test/
    datasets/<product>/labels/train|val|test/

Background images get an EMPTY .txt label written into labels/<split>/. That is
how YOLO represents "this image contains nothing" — the file must exist, and be
empty. Without it Ultralytics treats the image as unlabelled and drops it from
the run, which is exactly the bug that shipped coster-v1: a single-class model
trained with zero true negatives has no concept of "not-coster" and fires on
backgrounds and unrelated objects. Confidence thresholds only paper over it.

Leakage guards (each split must be disjoint, or the reported mAP is fiction):
  - Each source file lands in exactly one split.
  - A stem appearing in both raw/positive/ and raw/background/ is a mistake —
    it's reported and the positive wins, so the pair can't straddle splits.
  - Byte-identical duplicates (same SHA-256) are grouped and assigned together,
    so a re-saved copy of a training image can never appear in val/test.
  - Stratification is per-source, so positives and negatives are both
    represented in every split at roughly the configured ratio.

Usage:
    cd services
    python -m vision.object_detection.scripts.split_dataset --product coster-v1
    python -m vision.object_detection.scripts.split_dataset --product coster-v1 --no-background

Notes:
  - Positive images without a matching .txt label file are skipped (warned).
  - Run again to re-split; output dirs are cleared first.
"""

import argparse
import hashlib
import logging
import random
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SPLITS = {"train": 0.70, "val": 0.15, "test": 0.15}
SPLIT_ORDER = ("train", "val", "test")
IMG_EXTS = {".jpg", ".jpeg", ".png"}


@dataclass(frozen=True)
class Sample:
    """One image destined for a split, plus the label file to write beside it."""

    image: Path
    # None for a background/negative — an empty label file is written instead.
    label: Path | None
    source: str  # "positive" | "background"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Split annotated dataset into train/val/test")
    p.add_argument("--product", required=True, help="Dataset name, e.g. coster-v1")
    p.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    p.add_argument(
        "--no-background",
        action="store_true",
        help="Skip raw/background/ (NOT recommended — negatives are what stop false positives)",
    )
    return p.parse_args()


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def collect_samples(root: Path, include_background: bool = True) -> list[Sample]:
    """Gather positives (image+label) and backgrounds (image only) from raw/."""
    samples: list[Sample] = []
    seen_stems: set[str] = set()

    pos_dir = root / "raw" / "positive"
    if pos_dir.is_dir():
        for img_path in sorted(pos_dir.iterdir()):
            if img_path.suffix.lower() not in IMG_EXTS:
                continue
            label_path = img_path.with_suffix(".txt")
            if not label_path.exists():
                log.warning("Skipping %s — no matching .txt label file", img_path.name)
                continue
            seen_stems.add(img_path.stem)
            samples.append(Sample(image=img_path, label=label_path, source="positive"))

    bg_dir = root / "raw" / "background"
    if not include_background:
        log.warning("--no-background passed — training without true negatives.")
    elif bg_dir.is_dir():
        for img_path in sorted(bg_dir.iterdir()):
            if img_path.suffix.lower() not in IMG_EXTS:
                continue
            if img_path.stem in seen_stems:
                # Same stem in both folders would collide on copy-out and could
                # land the two copies in different splits.
                log.warning(
                    "Skipping background %s — stem already used by a positive image",
                    img_path.name,
                )
                continue
            seen_stems.add(img_path.stem)
            samples.append(Sample(image=img_path, label=None, source="background"))
    else:
        log.warning(
            "No raw/background/ directory at %s — training WITHOUT true negatives. "
            "A single-class model with no negatives false-positives on backgrounds; "
            "capture some with: python -m vision.object_detection.scripts.capture_images "
            "--product <name> --target background --count 100",
            bg_dir,
        )

    return samples


def group_duplicates(samples: list[Sample]) -> list[list[Sample]]:
    """Group byte-identical images so duplicates never straddle two splits."""
    by_hash: dict[str, list[Sample]] = {}
    for s in samples:
        by_hash.setdefault(_sha256(s.image), []).append(s)

    dupes = sum(len(g) - 1 for g in by_hash.values() if len(g) > 1)
    if dupes:
        log.warning(
            "%d duplicate image(s) detected (identical bytes) — each duplicate group is "
            "assigned to a single split to prevent train/val leakage.",
            dupes,
        )
    return list(by_hash.values())


def assign_splits(samples: list[Sample], seed: int = 42) -> dict[str, list[Sample]]:
    """Stratify per source so every split holds both positives and negatives."""
    split_map: dict[str, list[Sample]] = {name: [] for name in SPLIT_ORDER}
    rng = random.Random(seed)

    for source in ("positive", "background"):
        groups = group_duplicates([s for s in samples if s.source == source])
        if not groups:
            continue
        rng.shuffle(groups)

        n_total = len(groups)
        n_train = int(n_total * SPLITS["train"])
        n_val = int(n_total * SPLITS["val"])
        chunks = {
            "train": groups[:n_train],
            "val": groups[n_train : n_train + n_val],
            "test": groups[n_train + n_val :],
        }
        for split, split_groups in chunks.items():
            for group in split_groups:
                split_map[split].extend(group)

    return split_map


def write_splits(root: Path, split_map: dict[str, list[Sample]]) -> None:
    for split in SPLIT_ORDER:
        items = split_map[split]
        img_out = root / "images" / split
        lbl_out = root / "labels" / split
        shutil.rmtree(img_out, ignore_errors=True)
        shutil.rmtree(lbl_out, ignore_errors=True)
        img_out.mkdir(parents=True)
        lbl_out.mkdir(parents=True)

        for sample in items:
            shutil.copy2(sample.image, img_out / sample.image.name)
            label_dst = lbl_out / (sample.image.stem + ".txt")
            if sample.label is not None:
                shutil.copy2(sample.label, label_dst)
            else:
                # Empty label file == "no objects in this image" for YOLO.
                label_dst.write_text("", encoding="utf-8")

        n_pos = sum(1 for s in items if s.source == "positive")
        n_bg = len(items) - n_pos
        log.info("  %-5s: %d images (%d positive, %d background)", split, len(items), n_pos, n_bg)


def main() -> None:
    args = parse_args()
    root = Path(__file__).parent.parent / "datasets" / args.product

    if not (root / "raw").is_dir():
        log.error("raw/ directory not found: %s", root / "raw")
        sys.exit(1)

    samples = collect_samples(root, include_background=not args.no_background)
    if not any(s.source == "positive" for s in samples):
        log.error(
            "No annotated images found in %s. "
            "Annotate your images first (LabelImg or Roboflow) and export as YOLO format.",
            root / "raw" / "positive",
        )
        sys.exit(1)

    n_pos = sum(1 for s in samples if s.source == "positive")
    log.info(
        "Found %d annotated positive(s) and %d background(s). Splitting…",
        n_pos,
        len(samples) - n_pos,
    )

    split_map = assign_splits(samples, args.seed)
    write_splits(root, split_map)

    log.info("Split complete. data.yaml is at %s", root / "data.yaml")


if __name__ == "__main__":
    main()
