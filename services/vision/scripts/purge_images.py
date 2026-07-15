"""
purge_images.py — anonymization: delete face JPEGs past the retention window.

The visitor row (embedding, timestamps, name/email) is kept so recognition
keeps working; only image_path is set to NULL. A second pass removes orphan
JPEGs that have no matching row (leftovers from crashes mid-enroll).

Usage (from services/vision/, venv active):
    python scripts/purge_images.py [--dry-run]

Schedule daily, e.g. Windows Task Scheduler:
    Program:  <service>\\.venv\\Scripts\\python.exe
    Args:     scripts\\purge_images.py
    Start in: <service dir>
"""

from __future__ import annotations
import argparse
import logging
import os
import sys
import time

import psycopg

# Put services/ (the parent of the `vision` package) on the path.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from vision.config import load_config  # noqa: E402

log = logging.getLogger("purge-images")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Purge face JPEGs past retention.")
    parser.add_argument("--dry-run", action="store_true", help="Report only; delete nothing.")
    args = parser.parse_args()

    cfg = load_config()
    retention_days = cfg.image_retention_days
    log.info(
        "Purging face images older than %d days from %s%s",
        retention_days, cfg.image_dir, " (dry run)" if args.dry_run else "",
    )

    purged = 0
    orphans = 0
    with psycopg.connect(cfg.database_url, autocommit=True) as conn:
        # Pass 1: expired rows → delete JPEG, NULL out image_path.
        with conn.cursor() as cur:
            cur.execute(
                "SELECT uuid::text, image_path FROM visitor "
                "WHERE image_path IS NOT NULL "
                "AND first_seen < now() - make_interval(days => %s)",
                (retention_days,),
            )
            expired = cur.fetchall()

        for visitor_uuid, image_path in expired:
            # image_path is a bare filename; refuse anything that isn't.
            if os.path.basename(image_path) != image_path:
                log.warning("Skipping suspicious image_path %r (visitor %s)", image_path, visitor_uuid)
                continue
            full = os.path.join(cfg.image_dir, image_path)
            if args.dry_run:
                log.info("[dry-run] Would purge %s (visitor %s)", image_path, visitor_uuid)
                purged += 1
                continue
            try:
                os.remove(full)
            except FileNotFoundError:
                pass
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE visitor SET image_path = NULL WHERE uuid = %s",
                    (visitor_uuid,),
                )
            purged += 1

        # Pass 2: orphan JPEGs older than retention with no visitor row.
        with conn.cursor() as cur:
            cur.execute("SELECT image_path FROM visitor WHERE image_path IS NOT NULL")
            referenced = {row[0] for row in cur.fetchall()}

        cutoff = time.time() - retention_days * 86400
        if os.path.isdir(cfg.image_dir):
            for name in os.listdir(cfg.image_dir):
                if not name.lower().endswith(".jpg") or name in referenced:
                    continue
                full = os.path.join(cfg.image_dir, name)
                try:
                    if os.path.getmtime(full) >= cutoff:
                        continue
                    if args.dry_run:
                        log.info("[dry-run] Would remove orphan %s", name)
                    else:
                        os.remove(full)
                    orphans += 1
                except OSError:
                    log.warning("Could not inspect/remove %s", full, exc_info=True)

    log.info("Done: %d visitor images purged, %d orphan files removed.", purged, orphans)


if __name__ == "__main__":
    main()
