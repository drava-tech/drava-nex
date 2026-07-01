CREATE TYPE "public"."product_status" AS ENUM('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."product_media_purpose" AS ENUM('THUMBNAIL', 'HERO', 'GALLERY', 'VIDEO', 'BROCHURE', 'DOCUMENT', 'MODEL_3D');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sku" text,
	"detection_label" text,
	"category" text,
	"brand" text,
	"short_description" text,
	"full_description" text,
	"status" "product_status" DEFAULT 'DRAFT' NOT NULL,
	"thumbnail_media_id" text,
	"hero_media_id" text,
	"demo_video_media_id" text,
	"metadata" jsonb,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_feature" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"product_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_specification" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"product_id" text NOT NULL,
	"group_name" text NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"unit" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_media" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"product_id" text NOT NULL,
	"media_id" text NOT NULL,
	"media_type" text NOT NULL,
	"purpose" "product_media_purpose" NOT NULL,
	"alt_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_thumbnail_media_id_media_asset_id_fk" FOREIGN KEY ("thumbnail_media_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_hero_media_id_media_asset_id_fk" FOREIGN KEY ("hero_media_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_demo_video_media_id_media_asset_id_fk" FOREIGN KEY ("demo_video_media_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_feature" ADD CONSTRAINT "product_feature_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_specification" ADD CONSTRAINT "product_specification_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_media_id_media_asset_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_slug_unique_idx" ON "product" USING btree ("slug") WHERE "product"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_sku_unique_idx" ON "product" USING btree ("sku") WHERE "product"."deleted_at" IS NULL AND "product"."sku" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_detection_label_unique_idx" ON "product" USING btree ("detection_label") WHERE "product"."deleted_at" IS NULL AND "product"."detection_label" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "product_status_idx" ON "product" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_category_idx" ON "product" USING btree ("category");--> statement-breakpoint
CREATE INDEX "product_deleted_at_idx" ON "product" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "product_feature_product_idx" ON "product_feature" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_specification_product_idx" ON "product_specification" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_unique_idx" ON "product_media" USING btree ("product_id","media_id","purpose");--> statement-breakpoint
CREATE INDEX "product_media_product_idx" ON "product_media" USING btree ("product_id");
