CREATE TABLE IF NOT EXISTS "device" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"device_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_device_id_unique_idx" ON "device" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_type_idx" ON "device" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_deleted_at_idx" ON "device" USING btree ("deleted_at");
