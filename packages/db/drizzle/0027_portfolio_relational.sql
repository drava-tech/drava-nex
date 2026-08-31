CREATE TYPE "public"."portfolio_category_type" AS ENUM('images', 'videos', 'gallery');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_vertical" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"experience_id" text NOT NULL,
	"slot_index" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"video_url" text,
	"description" text,
	"button1" text DEFAULT 'Watch Video' NOT NULL,
	"button2" text DEFAULT 'Projects' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_category" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"vertical_id" text NOT NULL,
	"slot_index" integer NOT NULL,
	"name" text NOT NULL,
	"type" "portfolio_category_type" DEFAULT 'images' NOT NULL,
	"title" text,
	"subtitle" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_category_image" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"category_id" text NOT NULL,
	"url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_category_video" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"category_id" text NOT NULL,
	"url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_project" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"category_id" text NOT NULL,
	"company_id" text,
	"title" text,
	"subtitle" text,
	"description" text,
	"video_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_project_image" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_settings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"experience_id" text NOT NULL,
	"overview_title_font_size" integer DEFAULT 50 NOT NULL,
	"overview_description_font_size" integer DEFAULT 22 NOT NULL,
	"overview_button_font_size" integer DEFAULT 20 NOT NULL,
	"overview_card_padding" integer DEFAULT 44 NOT NULL,
	"gallery_title_font_size" integer DEFAULT 64 NOT NULL,
	"gallery_subtitle_font_size" integer DEFAULT 24 NOT NULL,
	"gallery_description_font_size" integer DEFAULT 20 NOT NULL,
	"gallery_gap" integer DEFAULT 26 NOT NULL,
	"gallery_padding" integer DEFAULT 78 NOT NULL,
	"gallery_background_color" text DEFAULT '#e8e8f7' NOT NULL,
	"gallery_text_color" text DEFAULT '#111114' NOT NULL,
	"gallery_expanded_pct" integer DEFAULT 70 NOT NULL,
	"gallery_blur_px" integer DEFAULT 12 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolio_vertical" ADD CONSTRAINT "portfolio_vertical_experience_id_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experience"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_category" ADD CONSTRAINT "portfolio_category_vertical_id_portfolio_vertical_id_fk" FOREIGN KEY ("vertical_id") REFERENCES "public"."portfolio_vertical"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_category_image" ADD CONSTRAINT "portfolio_category_image_category_id_portfolio_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."portfolio_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_category_video" ADD CONSTRAINT "portfolio_category_video_category_id_portfolio_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."portfolio_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_project" ADD CONSTRAINT "portfolio_project_category_id_portfolio_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."portfolio_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_project" ADD CONSTRAINT "portfolio_project_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_project_image" ADD CONSTRAINT "portfolio_project_image_project_id_portfolio_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."portfolio_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_settings" ADD CONSTRAINT "portfolio_settings_experience_id_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experience"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_vertical_experience_slot_idx" ON "portfolio_vertical" USING btree ("experience_id","slot_index");--> statement-breakpoint
CREATE INDEX "portfolio_vertical_experience_idx" ON "portfolio_vertical" USING btree ("experience_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_category_vertical_slot_idx" ON "portfolio_category" USING btree ("vertical_id","slot_index");--> statement-breakpoint
CREATE INDEX "portfolio_category_vertical_idx" ON "portfolio_category" USING btree ("vertical_id");--> statement-breakpoint
CREATE INDEX "portfolio_category_image_category_idx" ON "portfolio_category_image" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "portfolio_category_video_category_idx" ON "portfolio_category_video" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_slug_unique_idx" ON "company" USING btree ("slug") WHERE "company"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "company_deleted_at_idx" ON "company" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "company_name_idx" ON "company" USING btree ("name");--> statement-breakpoint
CREATE INDEX "portfolio_project_category_idx" ON "portfolio_project" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "portfolio_project_company_idx" ON "portfolio_project" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "portfolio_project_image_project_idx" ON "portfolio_project_image" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_settings_experience_unique_idx" ON "portfolio_settings" USING btree ("experience_id");
