CREATE TABLE IF NOT EXISTS "visitor" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'guest' NOT NULL,
	"image_path" text,
	"embedding" vector(512) NOT NULL,
	"user_id" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visitor" ADD CONSTRAINT "visitor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visitor_uuid_unique_idx" ON "visitor" USING btree ("uuid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitor_last_seen_idx" ON "visitor" USING btree ("last_seen");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitor_embedding_hnsw_idx" ON "visitor" USING hnsw ("embedding" vector_cosine_ops);
