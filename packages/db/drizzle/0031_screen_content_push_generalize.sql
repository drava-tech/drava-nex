ALTER TABLE "screen_media_push" RENAME TO "screen_content_push";--> statement-breakpoint
ALTER TABLE "screen_content_push" ADD COLUMN IF NOT EXISTS "content_kind" text NOT NULL DEFAULT 'media';--> statement-breakpoint
ALTER TABLE "screen_content_push" ALTER COLUMN "content_kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "screen_content_push" ALTER COLUMN "media_asset_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "screen_content_push" ADD COLUMN IF NOT EXISTS "experience_id" text;--> statement-breakpoint
ALTER TABLE "screen_content_push" ADD CONSTRAINT "screen_content_push_experience_id_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experience"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "screen_content_push_experience_id_idx" ON "screen_content_push" USING btree ("experience_id");
