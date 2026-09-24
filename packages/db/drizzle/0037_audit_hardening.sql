ALTER TABLE "voice_command_log" ADD COLUMN IF NOT EXISTS "code" text;
--> statement-breakpoint
ALTER TABLE "voice_command_log" ADD COLUMN IF NOT EXISTS "session_id" text;
--> statement-breakpoint
ALTER TABLE "voice_command_log" ADD COLUMN IF NOT EXISTS "was_replay" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_command_log_session_id_idx" ON "voice_command_log" USING btree ("session_id");
--> statement-breakpoint
ALTER TABLE "door_event" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'cms' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_failure_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"route" text NOT NULL,
	"reason" text NOT NULL,
	"source_ip" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_failure_log_created_at_idx" ON "auth_failure_log" USING btree ("created_at");
--> statement-breakpoint
-- Tamper protection: these three tables exist specifically as audit trails,
-- so they should be append-only — nothing in this application ever needs to
-- UPDATE or DELETE a row in them, and someone with raw DB access silently
-- editing/removing history is exactly the failure mode an audit trail exists
-- to rule out.
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "voice_command_log_append_only" ON "voice_command_log";
--> statement-breakpoint
CREATE TRIGGER "voice_command_log_append_only"
	BEFORE UPDATE OR DELETE ON "voice_command_log"
	FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "door_event_append_only" ON "door_event";
--> statement-breakpoint
CREATE TRIGGER "door_event_append_only"
	BEFORE UPDATE OR DELETE ON "door_event"
	FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "auth_failure_log_append_only" ON "auth_failure_log";
--> statement-breakpoint
CREATE TRIGGER "auth_failure_log_append_only"
	BEFORE UPDATE OR DELETE ON "auth_failure_log"
	FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();