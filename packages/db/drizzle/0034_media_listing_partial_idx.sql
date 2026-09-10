-- Replaces 0033's composite index, which the planner would not use.
--
-- Every media listing carries the same fixed filter (deleted_at IS NULL AND
-- pending_save = false), so leading a btree with those two columns buys
-- nothing: measured with EXPLAIN, the planner ignored the composite entirely
-- and fell back to media_asset_deleted_at_idx plus a Sort, which re-sorts the
-- whole matching set on every keyset page.
--
-- As a PARTIAL index the filter moves into the index predicate and the key
-- becomes exactly the sort order, so a cursor page is a direct ordered scan
-- with no Sort node — the property that keeps deep scrolling O(page) instead of
-- O(everything matching). It is also smaller (32 kB vs 56 kB here).
DROP INDEX IF EXISTS "media_asset_listing_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_asset_listing_idx"
	ON "media_asset" USING btree ("created_at" DESC,"id" DESC)
	WHERE "deleted_at" IS NULL AND "pending_save" = false;
