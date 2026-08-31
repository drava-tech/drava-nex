ALTER TABLE "media_asset" ADD COLUMN IF NOT EXISTS "pending_save" boolean NOT NULL DEFAULT false;
