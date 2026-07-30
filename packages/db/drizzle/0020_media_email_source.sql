ALTER TABLE "media_asset" ADD COLUMN IF NOT EXISTS "source" text;
ALTER TABLE "media_asset" ADD COLUMN IF NOT EXISTS "email_from" text;
ALTER TABLE "media_asset" ADD COLUMN IF NOT EXISTS "email_subject" text;
CREATE INDEX IF NOT EXISTS "media_asset_source_idx" ON "media_asset" ("source");
