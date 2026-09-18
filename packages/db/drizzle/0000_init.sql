CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text DEFAULT 'OPERATOR' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_push" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"screen_id" text NOT NULL,
	"media_id" text,
	"action" text NOT NULL,
	"pushed_by_user_id" text,
	"pushed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_asset" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"bucket" text,
	"object_key" text,
	"content_type" text,
	"size_bytes" bigint,
	"thumb_object_key" text,
	"external_url" text,
	"uploaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_asset_has_location" CHECK (("media_asset"."object_key" IS NOT NULL AND "media_asset"."bucket" IS NOT NULL) OR "media_asset"."external_url" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "pairing_code" (
	"code" text PRIMARY KEY NOT NULL,
	"screen_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screen" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"device_token_hash" text,
	"paired_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"current_media_id" text,
	"queue_media_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"queue_index" integer DEFAULT 0 NOT NULL,
	"default_media_id" text,
	"blanked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_push" ADD CONSTRAINT "content_push_screen_id_screen_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screen"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_push" ADD CONSTRAINT "content_push_media_id_media_asset_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_push" ADD CONSTRAINT "content_push_pushed_by_user_id_user_id_fk" FOREIGN KEY ("pushed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_code" ADD CONSTRAINT "pairing_code_screen_id_screen_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screen"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen" ADD CONSTRAINT "screen_current_media_id_media_asset_id_fk" FOREIGN KEY ("current_media_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen" ADD CONSTRAINT "screen_default_media_id_media_asset_id_fk" FOREIGN KEY ("default_media_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "content_push_screen_idx" ON "content_push" USING btree ("screen_id","pushed_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "media_asset_listing_idx" ON "media_asset" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "media_asset"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_object_idx" ON "media_asset" USING btree ("bucket","object_key") WHERE "media_asset"."object_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pairing_code_screen_idx" ON "pairing_code" USING btree ("screen_id");--> statement-breakpoint
CREATE INDEX "screen_listing_idx" ON "screen" USING btree ("created_at") WHERE "screen"."deleted_at" IS NULL;