CREATE TYPE "public"."screen_status" AS ENUM('online', 'offline', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('image', 'video', 'pdf', 'stream');--> statement-breakpoint
CREATE TABLE "screens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(100) NOT NULL,
	"status" "screen_status" DEFAULT 'offline' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"component_name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"template_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(100) NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screen_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screen_id" uuid NOT NULL,
	"experience_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(100) NOT NULL,
	"mqtt_topic" varchar(500) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"trigger" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"type" "asset_type" NOT NULL,
	"url" varchar(2048) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_assignments" ADD CONSTRAINT "screen_assignments_screen_id_screens_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_assignments" ADD CONSTRAINT "screen_assignments_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_assignments" ADD CONSTRAINT "screen_assignments_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "screens_code_unique_idx" ON "screens" USING btree ("code");--> statement-breakpoint
CREATE INDEX "screens_status_idx" ON "screens" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_slug_unique_idx" ON "templates" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "templates_component_name_idx" ON "templates" USING btree ("component_name");--> statement-breakpoint
CREATE UNIQUE INDEX "experiences_slug_unique_idx" ON "experiences" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "experiences_template_id_idx" ON "experiences" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "experiences_active_idx" ON "experiences" USING btree ("active");--> statement-breakpoint
CREATE INDEX "contents_experience_id_idx" ON "contents" USING btree ("experience_id");--> statement-breakpoint
CREATE INDEX "contents_active_idx" ON "contents" USING btree ("active");--> statement-breakpoint
CREATE INDEX "contents_type_idx" ON "contents" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "screen_assignments_unique_triplet_idx" ON "screen_assignments" USING btree ("screen_id","experience_id","content_id");--> statement-breakpoint
CREATE INDEX "screen_assignments_screen_id_idx" ON "screen_assignments" USING btree ("screen_id");--> statement-breakpoint
CREATE INDEX "screen_assignments_experience_id_idx" ON "screen_assignments" USING btree ("experience_id");--> statement-breakpoint
CREATE INDEX "screen_assignments_content_id_idx" ON "screen_assignments" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "screen_assignments_active_idx" ON "screen_assignments" USING btree ("active");--> statement-breakpoint
CREATE INDEX "devices_mqtt_topic_idx" ON "devices" USING btree ("mqtt_topic");--> statement-breakpoint
CREATE INDEX "devices_enabled_idx" ON "devices" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "devices_type_idx" ON "devices" USING btree ("type");--> statement-breakpoint
CREATE INDEX "rules_enabled_idx" ON "rules" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "assets_content_id_idx" ON "assets" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "assets_type_idx" ON "assets" USING btree ("type");