-- Additive migration applied to the real shared cms_db, moving face-crop
-- IMAGES off local disk (services/vision/data/faces/…) into the database, so
-- the crops "live" in the DB and are served straight from there (the CMS
-- Visitors page + apps/api image route) with nothing left in the project
-- folder. Purely additive — nullable BYTEA columns, no data touched:
--
--   visitor_embedding.image_bytes — the JPEG for each numbered angle-sample
--       (one per row, keyed by the existing photo_number). This is the full
--       set of crops that previously sat on disk as {person}/{NN}.jpg.
--   visitor.image_bytes           — the representative/primary crop (photo 1),
--       what the CMS thumbnail + GET /api/visitors/:uuid/image now serve via
--       Drizzle (a targeted single-column read, never selected in list rows).
--
-- The teammate's `visitor` table otherwise stays exactly as defined in
-- packages/db/src/schema/visitors.ts; `image_path` is kept as a lightweight
-- non-null presence marker (drives hasImage) — the bytes are the new source
-- of truth. Apply with psql/psycopg against DATABASE_URL, same as the other
-- *_migration.sql here. Idempotent; safe to re-run.

ALTER TABLE visitor_embedding ADD COLUMN IF NOT EXISTS image_bytes BYTEA;
ALTER TABLE visitor           ADD COLUMN IF NOT EXISTS image_bytes BYTEA;
