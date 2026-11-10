-- Screen groups: a named set of screens the CMS lists together. A screen sits
-- in at most one group; deleting a group leaves its screens ungrouped.
CREATE TABLE IF NOT EXISTS "screen_group" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "screen" ADD COLUMN IF NOT EXISTS "group_id" text;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "screen" ADD CONSTRAINT "screen_group_id_screen_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."screen_group"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "screen_group_id_idx" ON "screen" USING btree ("group_id");
