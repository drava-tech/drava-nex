"""
assign_names.py — retroactively name visitors already sitting anonymously in
the real shared cms_db (DATABASE_URL), one at a time.

Separate from test_rtsp_pipeline_postgres.py's in-the-moment naming prompt,
which only fires the instant a new person is enrolled — it has no way to
revisit someone enrolled earlier (e.g. by preview_recognition.py, or skipped
with Enter at the time). This script instead lists everyone currently
unnamed, shows each one's stored photo, and lets you type a name or skip.

Usage (from services/vision/, venv active). Reads DATABASE_URL from
services/vision/.env:
    python scripts/assign_names.py
Press Enter on any prompt to leave that person unnamed and move to the next.
"""

from __future__ import annotations
import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from vision.angle_sampling import (  # noqa: E402
    close_photo_preview, make_config, rename_person_folder, show_photo_preview_bytes,
)
from vision.db_face_recognition import FaceRecognitionDb  # noqa: E402


def main() -> None:
    load_dotenv()

    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        print("!! Set DATABASE_URL in .env first.")
        sys.exit(1)

    cfg = make_config(database_url="unused", api_url="http://localhost:4000", broadcast_secret="unused",
                       camera_id="cam-assign-names",
                       # See test_rtsp_pipeline_postgres.py for the calibration
                       # rationale. Kept consistent here even though this script
                       # doesn't match/enroll, since it's the same cfg passed to
                       # FaceRecognitionDb.
                       match_max_distance=0.65)

    face_db = FaceRecognitionDb(database_url, cfg.match_max_distance, cfg.cooldown_seconds)
    face_db.connect()

    rows = face_db.query_all(
        "SELECT uuid::text, image_path FROM visitor "
        "WHERE name = '' OR name IS NULL ORDER BY first_seen"
    )
    if not rows:
        print("Nobody unnamed — every visitor already has a name.")
        face_db.close()
        return

    print(f"{len(rows)} unnamed visitor(s). Press Enter on any prompt to skip.")
    named = 0
    for visitor_uuid, image_path in rows:
        preview_shown = False
        note = ""
        if image_path:
            note = f" (photo: {image_path})"
            preview_shown = show_photo_preview_bytes(face_db.get_primary_image(visitor_uuid))
            if not preview_shown:
                print(f"  (no stored crop to preview for {visitor_uuid[:8]})")
        name = input(f"[{visitor_uuid[:8]}]{note} — name? (Enter to skip): ").strip()
        if preview_shown:
            close_photo_preview()
        if name:
            face_db.set_name(visitor_uuid, name)
            named += 1
            rename_person_folder(face_db, cfg, visitor_uuid, name, image_path)
            print(f"  -> named '{name}'")

    print(f"Named {named}/{len(rows)}.")
    face_db.close()


if __name__ == "__main__":
    main()
