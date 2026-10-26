-- A busy screen is recorded as a 'skipped' row (not a greeting) with the reason.
ALTER TABLE "visitor_greeting" ADD COLUMN IF NOT EXISTS "skip_reason" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visitor_greeting" ADD CONSTRAINT "visitor_greeting_kind_check" CHECK ("kind" in ('generic', 'named', 'skipped'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
