ALTER TABLE "screen" ADD COLUMN "whiteboard_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "screen" ADD COLUMN "whiteboard_state" jsonb;
