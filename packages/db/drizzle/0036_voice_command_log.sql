CREATE TABLE IF NOT EXISTS "voice_command_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tool" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"content" text,
	"params" jsonb,
	"success" boolean NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_command_log_created_at_idx" ON "voice_command_log" USING btree ("created_at");
