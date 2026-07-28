"""Dataset split — negatives are included, and splits stay disjoint.

Regression cover for the coster-v1 bug: the old split only read raw/positive/,
so the shipped model was trained with zero true negatives and false-positived on
backgrounds. Pure filesystem work — no torch, no ultralytics.
"""

from pathlib import Path

import pytest

from vision.object_detection.scripts.split_dataset import (
    Sample,
    assign_splits,
    collect_samples,
    write_splits,
)

# A 1x1 PNG — content only has to be decodable-looking and byte-comparable.
PNG_A = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6360000002000100ffff03000006000557bfabd400"
    "00000049454e44ae426082"
)


def make_dataset(root: Path, n_positive: int, n_background: int) -> None:
    pos = root / "raw" / "positive"
    bg = root / "raw" / "background"
    pos.mkdir(parents=True, exist_ok=True)
    if n_background:
        bg.mkdir(parents=True, exist_ok=True)

    for i in range(n_positive):
        (pos / f"positive_{i:04d}.jpg").write_bytes(PNG_A + bytes([i % 251]))
        (pos / f"positive_{i:04d}.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")
    for i in range(n_background):
        (bg / f"background_{i:04d}.jpg").write_bytes(PNG_A + b"bg" + bytes([i % 251]))


# ── collection ────────────────────────────────────────────────────────────────

def test_background_images_are_collected(tmp_path):
    make_dataset(tmp_path, n_positive=4, n_background=3)
    samples = collect_samples(tmp_path)

    assert sum(1 for s in samples if s.source == "positive") == 4
    assert sum(1 for s in samples if s.source == "background") == 3
    assert all(s.label is None for s in samples if s.source == "background")


def test_positive_without_label_file_is_skipped(tmp_path):
    make_dataset(tmp_path, n_positive=2, n_background=0)
    (tmp_path / "raw" / "positive" / "orphan.jpg").write_bytes(PNG_A + b"orphan")

    samples = collect_samples(tmp_path)
    assert {s.image.stem for s in samples} == {"positive_0000", "positive_0001"}


def test_no_background_flag_excludes_negatives(tmp_path):
    make_dataset(tmp_path, n_positive=3, n_background=3)
    samples = collect_samples(tmp_path, include_background=False)
    assert all(s.source == "positive" for s in samples)


def test_missing_background_dir_is_tolerated(tmp_path):
    make_dataset(tmp_path, n_positive=3, n_background=0)
    samples = collect_samples(tmp_path)
    assert len(samples) == 3


def test_stem_colliding_with_a_positive_is_dropped_from_background(tmp_path):
    """Same stem in both folders would collide on copy-out and could put two
    copies of one image in two different splits."""
    make_dataset(tmp_path, n_positive=2, n_background=0)
    bg = tmp_path / "raw" / "background"
    bg.mkdir(parents=True)
    (bg / "positive_0000.jpg").write_bytes(PNG_A + b"collide")

    samples = collect_samples(tmp_path)
    assert len(samples) == 2
    assert all(s.source == "positive" for s in samples)


# ── split assignment ──────────────────────────────────────────────────────────

def test_every_split_contains_positives_and_backgrounds(tmp_path):
    make_dataset(tmp_path, n_positive=20, n_background=20)
    split_map = assign_splits(collect_samples(tmp_path))

    for split in ("train", "val", "test"):
        sources = {s.source for s in split_map[split]}
        assert sources == {"positive", "background"}, f"{split} is missing a source: {sources}"


def test_splits_are_disjoint_and_lossless(tmp_path):
    make_dataset(tmp_path, n_positive=20, n_background=10)
    samples = collect_samples(tmp_path)
    split_map = assign_splits(samples)

    train = {s.image for s in split_map["train"]}
    val = {s.image for s in split_map["val"]}
    test = {s.image for s in split_map["test"]}

    assert not (train & val) and not (train & test) and not (val & test)
    assert train | val | test == {s.image for s in samples}


def test_duplicate_images_never_straddle_splits(tmp_path):
    """A re-saved copy of a training image in val/test inflates the reported
    mAP — identical bytes must land in one split."""
    make_dataset(tmp_path, n_positive=10, n_background=0)
    pos = tmp_path / "raw" / "positive"
    original = pos / "positive_0003.jpg"
    for i in range(5):
        copy = pos / f"copy_{i}.jpg"
        copy.write_bytes(original.read_bytes())
        copy.with_suffix(".txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")

    split_map = assign_splits(collect_samples(tmp_path))
    dup_bytes = original.read_bytes()

    holders = {
        split
        for split, items in split_map.items()
        if any(s.image.read_bytes() == dup_bytes for s in items)
    }
    assert len(holders) == 1, f"duplicate image leaked across splits: {holders}"


def test_split_assignment_is_deterministic_for_a_seed(tmp_path):
    make_dataset(tmp_path, n_positive=15, n_background=8)
    samples = collect_samples(tmp_path)

    a = assign_splits(samples, seed=7)
    b = assign_splits(samples, seed=7)
    assert {k: [s.image for s in v] for k, v in a.items()} == {
        k: [s.image for s in v] for k, v in b.items()
    }


# ── writing out ───────────────────────────────────────────────────────────────

def test_background_images_get_empty_label_files(tmp_path):
    """YOLO needs the .txt to EXIST and be empty; a missing file makes
    ultralytics drop the image, which is how the negatives went missing."""
    make_dataset(tmp_path, n_positive=10, n_background=10)
    write_splits(tmp_path, assign_splits(collect_samples(tmp_path)))

    wrote_an_empty_label = False
    for split in ("train", "val", "test"):
        for img in (tmp_path / "images" / split).iterdir():
            label = tmp_path / "labels" / split / f"{img.stem}.txt"
            assert label.exists(), f"{img.name} has no label file"
            if img.stem.startswith("background_"):
                assert label.read_text() == ""
                wrote_an_empty_label = True
            else:
                assert label.read_text().strip() != ""
    assert wrote_an_empty_label


def test_write_splits_clears_previous_output(tmp_path):
    make_dataset(tmp_path, n_positive=10, n_background=5)
    stale = tmp_path / "images" / "train"
    stale.mkdir(parents=True)
    (stale / "stale.jpg").write_bytes(PNG_A)

    write_splits(tmp_path, assign_splits(collect_samples(tmp_path)))
    assert not (stale / "stale.jpg").exists()


def test_written_splits_have_matching_image_and_label_counts(tmp_path):
    make_dataset(tmp_path, n_positive=14, n_background=6)
    write_splits(tmp_path, assign_splits(collect_samples(tmp_path)))

    total_images = 0
    for split in ("train", "val", "test"):
        images = list((tmp_path / "images" / split).iterdir())
        labels = list((tmp_path / "labels" / split).iterdir())
        assert len(images) == len(labels)
        total_images += len(images)
    assert total_images == 20
