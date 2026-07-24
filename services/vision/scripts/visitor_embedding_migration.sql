-- Additive migration applied to the real shared cms_db, per explicit
-- instruction to point the pipeline at DATABASE_URL instead of the local
-- test DB. Does not touch the existing `visitor` table (email/role/photo_url
-- and everything else on it are left exactly as the teammate defined them in
-- packages/db/src/schema/visitors.ts) — this only adds the new table that
-- lets one visitor have several stored angle-samples instead of a single
-- embedding column, which is what fixed the duplicate-enrollment bug during
-- local testing (see angle_sampling.py / find_best_match()).

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
