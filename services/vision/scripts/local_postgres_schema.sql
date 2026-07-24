-- Local Postgres schema for face recognition testing.
--
-- `visitor` is based on packages/db/src/schema/visitors.ts (the real,
-- teammate-owned table) but deliberately drops email/role — not used by
-- anything in this face-recognition pipeline, per explicit instruction.
-- This means our local schema now diverges from the real production table
-- on those two columns; worth telling your teammate this simplification is
-- wanted if/when they apply the visitor_embedding migration for real.
-- `visitor_embedding` is the one real addition — documented in
-- db_face_recognition.py as a proposed additive migration (new table,
-- doesn't touch `visitor` at all) for storing multiple angle-samples per
-- person instead of just one embedding column.
--
-- Run against a fresh local database that already has `CREATE EXTENSION
-- vector;` applied.

CREATE TABLE IF NOT EXISTS visitor (
    id SERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT gen_random_uuid(),
    name TEXT NOT NULL DEFAULT '',
    image_path TEXT,
    embedding VECTOR(512) NOT NULL,
    user_id TEXT,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS visitor_uuid_unique_idx ON visitor(uuid);
CREATE INDEX IF NOT EXISTS visitor_last_seen_idx ON visitor(last_seen);
CREATE INDEX IF NOT EXISTS visitor_embedding_hnsw_idx
    ON visitor USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS visitor_embedding (
    id SERIAL PRIMARY KEY,
    visitor_uuid UUID NOT NULL REFERENCES visitor(uuid),
    embedding VECTOR(512) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visitor_embedding_embedding_hnsw_idx
    ON visitor_embedding USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS visitor_embedding_visitor_uuid_idx
    ON visitor_embedding(visitor_uuid);
