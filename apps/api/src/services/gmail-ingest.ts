import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { google, type gmail_v1 } from "googleapis";
import { createMediaAsset, isMessageIngested, markMessageIngested } from "@platform/db";
import { UPLOAD_DIR, classifyUpload } from "../routes/media.js";

/**
 * Watches hello@thewhitetusker.com (or whichever mailbox GMAIL_IMPERSONATE_USER
 * names) for emails with attachments and turns each supported attachment into
 * a normal media_asset — same allowlist, same UPLOAD_DIR, same createMediaAsset
 * call as a manual upload (see routes/media.ts), so ingested content is
 * indistinguishable from something an admin uploaded by hand.
 *
 * Read-only (gmail.readonly) — the mailbox itself is never modified. Access
 * control lives entirely in the CMS's own auth on the resulting media_asset
 * row, not in Gmail/Drive sharing settings.
 */

const DEFAULT_POLL_MS = 120_000;

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

async function processMessage(gmail: gmail_v1.Gmail, messageId: string): Promise<void> {
  const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const headers = res.data.payload?.headers ?? [];
  const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value;
  const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value;

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
      source: "gmail",
      emailFrom: from ?? null,
      emailSubject: subject ?? null,
    });
  }

  // Mark processed even if nothing matched the allowlist, so we don't rescan
  // this message's attachments on every future poll.
  await markMessageIngested(messageId);
}

async function pollInbox(gmail: gmail_v1.Gmail): Promise<void> {
  const list = await gmail.users.messages.list({ userId: "me", q: "has:attachment", maxResults: 25 });
  for (const message of list.data.messages ?? []) {
    if (!message.id) continue;
    try {
      if (await isMessageIngested(message.id)) continue;
      await processMessage(gmail, message.id);
    } catch (err) {
      console.error(`[gmail-ingest] failed to process message ${message.id}:`, err);
    }
  }
}

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
  const gmail = google.gmail({ version: "v1", auth });

  const pollMs = Number(process.env["GMAIL_INGEST_POLL_MS"] ?? DEFAULT_POLL_MS);

  await pollInbox(gmail).catch((err) => console.error("[gmail-ingest] initial poll failed:", err));
  setInterval(() => {
    pollInbox(gmail).catch((err) => console.error("[gmail-ingest] poll failed:", err));
  }, pollMs);

  console.info(`[gmail-ingest] watching ${impersonate} for attachments every ${pollMs}ms`);
}
