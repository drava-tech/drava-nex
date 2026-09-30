-- Backs the media library listing + the /broadcast carousel's keyset paging.
-- listMediaAssets filters on (deleted_at IS NULL, pending_save = false) and then
-- orders by created_at DESC, id DESC — the id tie-break matters because a bulk
-- Gmail ingest writes many rows with an identical created_at, and a cursor seek
-- on created_at alone would skip rows sitting on that boundary.
CREATE INDEX IF NOT EXISTS "media_asset_listing_idx"
	ON "media_asset" USING btree ("deleted_at","pending_save","created_at" DESC,"id" DESC);
