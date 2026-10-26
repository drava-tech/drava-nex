CREATE TABLE IF NOT EXISTS "visitor_greeting" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitor_uuid" uuid NOT NULL,
	"greet_date" date NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"greeted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visitor_greeting" ADD CONSTRAINT "visitor_greeting_visitor_uuid_visitor_uuid_fk" FOREIGN KEY ("visitor_uuid") REFERENCES "public"."visitor"("uuid") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visitor_greeting_visitor_date_unique_idx" ON "visitor_greeting" USING btree ("visitor_uuid","greet_date");
