"""
backfill_images_to_db.py — one-time migration of the face-crop JPEGs that were
written to disk (services/vision/data/faces/{Name}_{uuid8}/{NN}.jpg) INTO the
database, now that crops live in Postgres instead of the project folder.

For each on-disk photo it:
  - resolves the visitor by the folder's short-uuid suffix
    ({name}_{uuid8} → visitor.uuid LIKE '{uuid8}%'),
  - writes the JPEG bytes onto the matching visitor_embedding row
    (keyed by photo_number == the NN in the filename),
  - sets visitor.image_bytes from photo 1 (the representative/primary crop the
    CMS thumbnail + GET /api/visitors/:uuid/image serve).

Idempotent — safe to re-run (it just rewrites the same bytes). Run AFTER
applying visitor_embedding_image_migration.sql. Nothing on disk is deleted;
remove data/faces/ yourself once you've confirmed the CMS shows the images.

Usage (from services/vision/, venv active). Reads DATABASE_URL from
services/vision/.env:
    python scripts/backfill_images_to_db.py
"""

from __future__ import annotations
import os
import sys

import psycopg
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from vision.angle_sampling import absolute_image_dir  # noqa: E402


def _photo_number(filename: str) -> int | None:
    """"01.jpg" -> 1. None if the stem isn't a plain number."""
    stem = os.path.splitext(filename)[0]
    return int(stem) if stem.isdigit() else None


def main() -> None:
    load_dotenv()
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        print("!! Set DATABASE_URL in .env first.")
        sys.exit(1)

    image_dir = absolute_image_dir()
    if not os.path.isdir(image_dir):
        print(f"Nothing to back-fill — {image_dir} does not exist.")
        return

    updated_samples = 0
    updated_primaries = 0
    missing_rows = 0
    skipped_visitors = 0

    with psycopg.connect(database_url, autocommit=True) as conn:
        for folder in sorted(os.listdir(image_dir)):
            folder_path = os.path.join(image_dir, folder)
            if not os.path.isdir(folder_path):
                continue

            uuid8 = folder.rsplit("_", 1)[-1]
            rows = conn.execute(
                "SELECT uuid::text FROM visitor WHERE uuid::text LIKE %s", (uuid8 + "%",)
            ).fetchall()
            if len(rows) != 1:
                which = "no" if not rows else f"{len(rows)} ambiguous"
                print(f"  skip {folder}: {which} matching visitor for uuid prefix {uuid8}")
                skipped_visitors += 1
                continue
            visitor_uuid = rows[0][0]

            for fname in sorted(os.listdir(folder_path)):
                if not fname.lower().endswith(".jpg"):
                    continue
                photo_number = _photo_number(fname)
                if photo_number is None:
                    print(f"  skip {folder}/{fname}: filename is not a photo number")
                    continue
                with open(os.path.join(folder_path, fname), "rb") as f:
                    img_bytes = f.read()

                cur = conn.execute(
                    "UPDATE visitor_embedding SET image_bytes = %s "
                    "WHERE visitor_uuid = %s AND photo_number = %s",
                    (img_bytes, visitor_uuid, photo_number),
                )
                if cur.rowcount == 0:
                    missing_rows += 1
                    print(f"  note {folder}/{fname}: no visitor_embedding row with "
                          f"photo_number={photo_number} (crop stored nowhere)")
                else:
                    updated_samples += cur.rowcount

                if photo_number == 1:
                    conn.execute(
                        "UPDATE visitor SET image_bytes = %s WHERE uuid = %s",
                        (img_bytes, visitor_uuid),
                    )
                    updated_primaries += 1

            print(f"  ok   {folder} -> {visitor_uuid}")

    print(f"\nDone. {updated_samples} sample crop(s) stored, "
          f"{updated_primaries} primary crop(s) set, "
          f"{missing_rows} file(s) had no matching embedding row, "
          f"{skipped_visitors} folder(s) skipped (no/ambiguous visitor).")


if __name__ == "__main__":
    main()
