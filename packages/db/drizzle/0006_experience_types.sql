CREATE TABLE IF NOT EXISTS "experience_type" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experience_to_type" (
	"experience_id" text NOT NULL,
	"type_id" text NOT NULL,
	CONSTRAINT "experience_to_type_experience_id_type_id_pk" PRIMARY KEY("experience_id","type_id")
);
--> statement-breakpoint
ALTER TABLE "experience_type" ADD CONSTRAINT "experience_type_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_to_type" ADD CONSTRAINT "experience_to_type_experience_id_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experience"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_to_type" ADD CONSTRAINT "experience_to_type_type_id_experience_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."experience_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "experience_type_name_unique_idx" ON "experience_type" ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experience_to_type_type_idx" ON "experience_to_type" ("type_id");
