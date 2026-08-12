ALTER TABLE "screen" ADD COLUMN IF NOT EXISTS "current_queue_media_ids" jsonb;
ALTER TABLE "screen" ADD COLUMN IF NOT EXISTS "current_queue_index" integer;
