CREATE TABLE IF NOT EXISTS "whiteboard_document" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "whiteboard_document" ADD CONSTRAINT "whiteboard_document_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_document" ADD CONSTRAINT "whiteboard_document_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whiteboard_document_created_by_idx" ON "whiteboard_document" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "whiteboard_document_deleted_at_idx" ON "whiteboard_document" USING btree ("deleted_at");
