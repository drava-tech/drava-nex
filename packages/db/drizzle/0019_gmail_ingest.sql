CREATE TABLE IF NOT EXISTS "gmail_ingested_message" (
	"message_id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
