import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { google, type gmail_v1 } from "googleapis";
import { createMediaAsset, isMessageIngested, markMessageIngested } from "@platform/db";
import { UPLOAD_DIR, classifyUpload } from "../routes/media.js";

/**
 * Watches hello@thewhitetusker.com (or whichever mailbox GMAIL_IMPERSONATE_USER
 * names) for emails, on demand — see runGmailLoad(). Each supported attachment
 * (PDF/.pptx, same allowlist as a manual upload) becomes a media_asset with
 * pendingSave: false — immediately a first-class Media Library asset
 * (assignable/playable right away), not a temporary row waiting on a
 * separate "keep" step.
 *
 * Deliberately attachments-only — links found in an email's HTML body are
 * NOT ingested. An earlier version pulled every `<a href>` in the body,
 * which in practice meant every unsubscribe link, click-tracking redirect,
 * account/settings link, and legal/support footer link in an email also
 * became a "webpage" media asset — a handful of real attachments buried
 * under dozens of incidental links nobody meant to push to a screen.
 *
 * Read-only (gmail.readonly) — the mailbox itself is never modified. Access
 * control lives entirely in the CMS's own auth on the resulting media_asset
 * row, not in Gmail/Drive sharing settings.
 */

// A single run is capped so one click on a very busy inbox can't run away —
// this is well beyond what "last 2 days" should ever actually produce.
const MAX_MESSAGES_PER_LOAD = 200;

function flattenAttachmentParts(part: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!part) return [];
  const result: gmail_v1.Schema$MessagePart[] = [];
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    if (p.filename) result.push(p);
    p.parts?.forEach(walk);
  };
  walk(part);
  return result;
}

function loadServiceAccountCredentials(): { client_email: string; private_key: string } | null {
  const keyJson = process.env["GOOGLE_SERVICE_ACCOUNT_KEY"];
  const keyPath = process.env["GOOGLE_SERVICE_ACCOUNT_KEY_PATH"];
  try {
    const raw = keyJson ?? (keyPath ? fs.readFileSync(keyPath, "utf-8") : null);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error("[gmail-ingest] failed to read service account key:", err);
    return null;
  }
}

async function processMessage(gmail: gmail_v1.Gmail, messageId: string): Promise<number> {
  const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const headers = res.data.payload?.headers ?? [];
  const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value;
  const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value;

  let added = 0;

  for (const part of flattenAttachmentParts(res.data.payload)) {
    const attachmentId = part.body?.attachmentId;
    if (!part.filename || !attachmentId) continue;

    const classified = classifyUpload(part.filename, part.mimeType ?? "");
    if (!classified) continue; // outside the allowlist (see ALLOWED in routes/media.ts) — skip

    const attachment = await gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId });
    const data = attachment.data.data;
    if (!data) continue;

    const bytes = Buffer.from(data, "base64url");
    await fsPromises.mkdir(UPLOAD_DIR, { recursive: true });
    const storedName = `${randomUUID()}${classified.ext}`;
    await fsPromises.writeFile(path.join(UPLOAD_DIR, storedName), bytes);

    const displayName =
      (part.filename || subject || "Email attachment").replace(/[^a-zA-Z0-9_.\- ]/g, "_").slice(0, 200) ||
      storedName;

    await createMediaAsset({
      type: classified.type,
      url: `/media/${storedName}`,
      name: displayName,
      sizeBytes: bytes.length,
      source: "email",
      emailFrom: from ?? null,
      emailSubject: subject ?? null,
      pendingSave: false,
    });
    added++;
  }

  // Mark processed even if nothing matched, so we don't rescan this message's
  // attachments on a future load.
  await markMessageIngested(messageId);
  return added;
}

// ─── Gmail client (built once at boot, reused by every on-demand load) ──────

let gmailClient: gmail_v1.Gmail | null = null;

export async function startGmailIngest(): Promise<void> {
  if (!process.env["GMAIL_INGEST_ENABLED"]) {
    console.warn("[gmail-ingest] disabled — GMAIL_INGEST_ENABLED not set");
    return;
  }

  const impersonate = process.env["GMAIL_IMPERSONATE_USER"];
  if (!impersonate) {
    console.warn("[gmail-ingest] disabled — GMAIL_IMPERSONATE_USER not set");
    return;
  }

  const credentials = loadServiceAccountCredentials();
  if (!credentials) {
    console.warn("[gmail-ingest] disabled — GOOGLE_SERVICE_ACCOUNT_KEY(_PATH) missing or unreadable");
    return;
  }

  // Domain-wide delegation: this service account impersonates `impersonate`
  // (a Workspace admin must have authorized its Client ID for the
  // gmail.readonly scope in Admin console → Security → API Controls).
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    subject: impersonate,
  });
  gmailClient = google.gmail({ version: "v1", auth });

  console.info(`[gmail-ingest] ready — watching ${impersonate} on demand (see "Load" in Email Media)`);
}

/**
 * On-demand load, triggered by the "Load last 2 days" button (see
 * apps/api/src/routes/media.ts POST /media/gmail/load). Not a background
 * poll — nothing happens with the mailbox except when this is called.
 */
export async function runGmailLoad(days = 2): Promise<{ added: number }> {
  if (!gmailClient) {
    throw new Error("Gmail ingest is not configured (GMAIL_INGEST_ENABLED/GMAIL_IMPERSONATE_USER/service account key)");
  }
  const gmail = gmailClient;

  let added = 0;
  let processedCount = 0;
  let pageToken: string | undefined;

  do {
    const list = await gmail.users.messages.list({
      userId: "me",
      q: `newer_than:${days}d`,
      maxResults: 50,
      pageToken,
    });

    for (const message of list.data.messages ?? []) {
      if (!message.id || processedCount >= MAX_MESSAGES_PER_LOAD) break;
      processedCount++;
      try {
        if (await isMessageIngested(message.id)) continue;
        added += await processMessage(gmail, message.id);
      } catch (err) {
        console.error(`[gmail-ingest] failed to process message ${message.id}:`, err);
      }
    }

    pageToken = list.data.nextPageToken ?? undefined;
  } while (pageToken && processedCount < MAX_MESSAGES_PER_LOAD);

  return { added };
}
