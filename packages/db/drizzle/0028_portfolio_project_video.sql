CREATE TYPE "public"."portfolio_gallery_kind" AS ENUM('photos', 'videos');--> statement-breakpoint
ALTER TABLE "portfolio_category" ADD COLUMN "gallery_kind" "portfolio_gallery_kind" DEFAULT 'photos' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_project_video" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolio_project_video" ADD CONSTRAINT "portfolio_project_video_project_id_portfolio_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."portfolio_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_project_video_project_idx" ON "portfolio_project_video" USING btree ("project_id");--> statement-breakpoint
INSERT INTO "portfolio_project_video" ("project_id", "url", "sort_order")
	SELECT "id", "video_url", 0 FROM "portfolio_project" WHERE "video_url" IS NOT NULL;--> statement-breakpoint
UPDATE "portfolio_category" SET "gallery_kind" = 'videos' WHERE "name" = 'Brand Films';--> statement-breakpoint
ALTER TABLE "portfolio_project" DROP COLUMN "video_url";
