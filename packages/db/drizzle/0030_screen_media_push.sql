CREATE TABLE IF NOT EXISTS "screen_media_push" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"screen_id" text NOT NULL,
	"media_asset_id" text NOT NULL,
	"pushed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "screen_media_push" ADD CONSTRAINT "screen_media_push_screen_id_screen_screen_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screen"("screen_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_media_push" ADD CONSTRAINT "screen_media_push_media_asset_id_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screen_media_push_screen_id_idx" ON "screen_media_push" USING btree ("screen_id");--> statement-breakpoint
CREATE INDEX "screen_media_push_pushed_at_idx" ON "screen_media_push" USING btree ("pushed_at");
