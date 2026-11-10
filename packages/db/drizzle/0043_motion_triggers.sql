-- Motion triggers: when a motion sensor sees someone, play an image or video on
-- chosen screens. See packages/db/src/schema/motion-triggers.ts.
CREATE TABLE IF NOT EXISTS "motion_trigger" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"sensor_id" text NOT NULL,
	"screen_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"media_asset_id" text,
	"duration_seconds" integer DEFAULT 30 NOT NULL,
	"cooldown_seconds" integer DEFAULT 300 NOT NULL,
	"start_time" text,
	"end_time" text,
	"days_of_week" jsonb DEFAULT '[0,1,2,3,4,5,6]'::jsonb NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "motion_trigger" ADD CONSTRAINT "motion_trigger_media_asset_id_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
