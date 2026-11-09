-- Scheduling: playlists of content that run on chosen screens inside a time
-- window. See packages/db/src/schema/schedules.ts.
CREATE TABLE IF NOT EXISTS "schedule" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#92ff5f' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"end_date" date,
	"days_of_week" jsonb DEFAULT '[0,1,2,3,4,5,6]'::jsonb NOT NULL,
	"start_time" text,
	"end_time" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"screen_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "schedule" ADD CONSTRAINT "schedule_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_item" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"schedule_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"content_kind" text NOT NULL,
	"experience_id" text,
	"media_asset_id" text,
	"duration_seconds" integer DEFAULT 30 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "schedule_item" ADD CONSTRAINT "schedule_item_schedule_id_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "schedule_item" ADD CONSTRAINT "schedule_item_experience_id_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experience"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "schedule_item" ADD CONSTRAINT "schedule_item_media_asset_id_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_item_schedule_idx" ON "schedule_item" USING btree ("schedule_id","position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_screen_state" (
	"screen_id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"item_key" text NOT NULL,
	"content_kind" text NOT NULL,
	"content_id" text NOT NULL,
	"previous_content_kind" text,
	"previous_content_id" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "schedule_screen_state" ADD CONSTRAINT "schedule_screen_state_screen_id_screen_screen_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screen"("screen_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
