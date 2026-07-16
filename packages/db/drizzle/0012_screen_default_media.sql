ALTER TABLE "screen" ADD COLUMN IF NOT EXISTS "default_media_asset_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "screen" ADD CONSTRAINT "screen_default_media_asset_id_media_asset_id_fk" FOREIGN KEY ("default_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "screen_default_media_asset_idx" ON "screen" USING btree ("default_media_asset_id");
