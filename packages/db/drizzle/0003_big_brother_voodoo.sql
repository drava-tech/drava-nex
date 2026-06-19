DROP INDEX "project_status_idx";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "thumbnail_url";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "video_url";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "client_name";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "location";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "settings_json";--> statement-breakpoint
DROP TYPE "public"."project_status";