"""
enroll_test.py — offline threshold tuning: pairwise cosine distances of photos.

Feed it two photos of the same person and two of different people, and compare
the distances against FACE_MATCH_MAX_DISTANCE. No database is touched.

Usage (from services/face-vision/, venv active):
    python scripts/enroll_test.py photo1.jpg photo2.jpg [photo3.jpg ...]
"""

from __future__ import annotations
import argparse
import itertools
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.config import load_config  # noqa: E402
from src.engine import FaceEngine  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Pairwise face distances between photos.")
    parser.add_argument("images", nargs="+", help="Two or more image files.")
    args = parser.parse_args()
    if len(args.images) < 2:
        parser.error("Provide at least two images.")

    cfg = load_config()
    engine = FaceEngine(cfg)
    engine.load()

    embeddings: dict[str, np.ndarray] = {}
    for path in args.images:
        img = cv2.imread(path)
        if img is None:
            print(f"!! Could not read {path}")
            continue
        faces = engine.detect(img)
        if not faces:
            print(f"!! No face found in {path}")
            continue
        best = max(faces, key=lambda f: float(f.det_score))
        embeddings[path] = best.normed_embedding
        print(f"   {path}: {len(faces)} face(s), best det_score {best.det_score:.3f}")

    print(f"\nThreshold FACE_MATCH_MAX_DISTANCE = {cfg.match_max_distance}\n")
    for a, b in itertools.combinations(embeddings, 2):
        # Cosine distance on unit-norm vectors — identical to pgvector's <=>.
        distance = 1.0 - float(np.dot(embeddings[a], embeddings[b]))
        verdict = "MATCH  " if distance <= cfg.match_max_distance else "no match"
        print(f"{verdict}  {distance:.4f}  {os.path.basename(a)} <-> {os.path.basename(b)}")


if __name__ == "__main__":
    main()
