import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Dedup marker for the Gmail attachment ingester (apps/api/src/services/gmail-ingest.ts).
 * Records which Gmail message IDs have already been turned into media_asset
 * rows, so repeated polling of the inbox doesn't re-ingest the same attachment.
 */
export const gmailIngestedMessage = pgTable("gmail_ingested_message", {
  messageId: text("message_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type GmailIngestedMessage = typeof gmailIngestedMessage.$inferSelect;
export type NewGmailIngestedMessage = typeof gmailIngestedMessage.$inferInsert;
