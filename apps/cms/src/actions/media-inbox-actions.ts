"use server";

import { requireGuestOrAdmin } from "@/lib/auth-helpers";

/**
 * The mailbox whose attachments "Load Email" brings into the media library
 * (GMAIL_IMPERSONATE_USER, see apps/api/src/services/gmail-ingest.ts), so the
 * Media page can tell a User where to send their files. null when it isn't set.
 */
export async function getMediaInbox(): Promise<string | null> {
  await requireGuestOrAdmin();
  const address = process.env["GMAIL_IMPERSONATE_USER"]?.trim();
  return address || null;
}
