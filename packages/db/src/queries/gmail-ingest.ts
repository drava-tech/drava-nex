import { eq } from "drizzle-orm";
import { db } from "../client.js";
import { gmailIngestedMessage } from "../schema/gmail-ingest.js";

/** Has this Gmail message already been processed by the ingester? */
export async function isMessageIngested(messageId: string): Promise<boolean> {
  const [row] = await db
    .select({ messageId: gmailIngestedMessage.messageId })
    .from(gmailIngestedMessage)
    .where(eq(gmailIngestedMessage.messageId, messageId))
    .limit(1);
  return !!row;
}

/** Record a Gmail message as processed so future polls skip it. */
export async function markMessageIngested(messageId: string): Promise<void> {
  await db.insert(gmailIngestedMessage).values({ messageId }).onConflictDoNothing();
}
