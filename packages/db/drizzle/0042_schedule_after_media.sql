-- A queue that plays once can name the image or video its screens show
-- afterwards; null keeps their normal idle screen.
ALTER TABLE "schedule" ADD COLUMN IF NOT EXISTS "after_media_asset_id" text;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "schedule" ADD CONSTRAINT "schedule_after_media_asset_id_media_asset_id_fk" FOREIGN KEY ("after_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
