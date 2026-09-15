CREATE TABLE IF NOT EXISTS "screen_status_sample" (
	"screen_id" text NOT NULL,
	"online" boolean NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "screen_status_sample_screen_id_sampled_at_pk" PRIMARY KEY("screen_id","sampled_at")
);
--> statement-breakpoint
ALTER TABLE "screen_status_sample" ADD CONSTRAINT "screen_status_sample_screen_id_screen_screen_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screen"("screen_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screen_status_sample_sampled_at_idx" ON "screen_status_sample" USING btree ("sampled_at");
