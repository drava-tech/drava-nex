CREATE TABLE IF NOT EXISTS "ambient_mode" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"color" text NOT NULL,
	"brightness" integer NOT NULL,
	"strip_on" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Defaults for the four whole-room modes. #FFF3E0 is the CMS "Warm White"
-- swatch (the fixtures' own white LEDs); #100073 is the presentation colour.
-- ON CONFLICT DO NOTHING so re-running never overwrites edits made in the CMS.
INSERT INTO "ambient_mode" ("key", "label", "position", "color", "brightness", "strip_on") VALUES
	('pre_entry', 'Pre-entry', 0, '#FFF3E0', 70, true),
	('entry', 'Entry', 1, '#FFF3E0', 80, true),
	('meeting', 'Meeting', 2, '#FFF3E0', 85, true),
	('presentation', 'Presentation', 3, '#100073', 15, false)
ON CONFLICT ("key") DO NOTHING;
