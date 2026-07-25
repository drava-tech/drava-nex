-- Additive migration on our own visitor_embedding table (doesn't touch the
-- real visitor table at all). Adds what's needed to compare stored samples
-- against a newly-captured one and replace the worst if the new one is
-- better, instead of just capping at MAX_TOTAL_SAMPLES_PER_VISITOR and
-- ignoring everything after: quality_score (composite det_score/pose/blur
-- ranking, see angle_sampling.sample_quality_score()) and photo_number
-- (which numbered photo in the person's folder this row corresponds to —
-- previously only inferred by row order, which broke the moment a row got
-- merged in from elsewhere, e.g. the Suman/5e8237dc merge earlier this
-- session).

ALTER TABLE visitor_embedding ADD COLUMN IF NOT EXISTS quality_score REAL;
ALTER TABLE visitor_embedding ADD COLUMN IF NOT EXISTS photo_number INT;

-- Backfill existing rows so photo_number matches the numbering already on
-- disk (insertion order per visitor == existing photo numbering, verified
-- against every visitor currently in the DB before writing this).
WITH ordered AS (
    SELECT id, row_number() OVER (PARTITION BY visitor_uuid ORDER BY id) AS seq
    FROM visitor_embedding
)
UPDATE visitor_embedding e
SET photo_number = ordered.seq
FROM ordered
WHERE e.id = ordered.id AND e.photo_number IS NULL;
