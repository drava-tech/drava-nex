import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { google, type gmail_v1 } from "googleapis";
import { createMediaAsset, isMessageIngested, markMessageIngested, getLastGmailIngestTimestamp } from "@platform/db";
import { classifyLink } from "@platform/types";
import { UPLOAD_DIR, classifyUpload } from "../routes/media.js";
import { thumbnailForUpload } from "./thumbnails.js";

/**
 * Watches hello@thewhitetusker.com (or whichever mailbox GMAIL_IMPERSONATE_USER
 * names) for emails, on demand — see runGmailLoad(). Each supported attachment
 * (PDF/.pptx, same allowlist as a manual upload) becomes a media_asset with
 * pendingSave: false — immediately a first-class Media Library asset
 * (assignable/playable right away), not a temporary row waiting on a
 * separate "keep" step.
 *
 * Mostly attachments-only — an earlier version also pulled every `<a href>`
 * out of the body, which in practice meant every unsubscribe link,
 * click-tracking redirect, account/settings link, and legal/support footer
 * link in an email also became a "webpage" media asset — a handful of real
 * attachments buried under dozens of incidental links nobody meant to push
 * to a screen. That's still true for links in general, but Gmail itself caps
 * attachments at 25MB and silently swaps anything larger for a Google Drive
 * share link in the body instead of a real attachment part — so body
 * scanning is narrowly reintroduced for Drive links only (see
 * extractDriveLinksFromBody), which is exactly the "real attachment, just
 * too big to attach" case the original attachments-only behavior was
 * missing, without reopening the unsubscribe-link noise problem.
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

/** Every body part (no filename) of a given MIME type, recursing into multipart/*. */
function flattenBodyParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string
): gmail_v1.Schema$MessagePart[] {
  if (!part) return [];
  const result: gmail_v1.Schema$MessagePart[] = [];
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    if (!p.filename && p.mimeType === mimeType && p.body?.data) result.push(p);
    p.parts?.forEach(walk);
  };
  walk(part);
  return result;
}

const HREF_RE = /href\s*=\s*"(https?:\/\/[^"]+)"/gi;
const BARE_URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/**
 * Google Drive share links found in an email's body — HTML anchor targets
 * preferred, plain text as a fallback if there's no HTML part. Every href is
 * still classified via classifyLink and immediately discarded unless it's a
 * Drive/Docs/Sheets/Slides link (type "drive") — this is what keeps
 * unsubscribe/tracking/footer links out, unlike the earlier removed version
 * that ingested every href indiscriminately.
 */
function extractDriveLinksFromBody(
  payload: gmail_v1.Schema$MessagePart | undefined
): { url: string; name: string }[] {
  const hrefs = new Set<string>();
  for (const part of flattenBodyParts(payload, "text/html")) {
    const html = Buffer.from(part.body!.data!, "base64url").toString("utf-8");
    for (const match of html.matchAll(HREF_RE)) {
      if (match[1]) hrefs.add(match[1]);
    }
  }
  if (hrefs.size === 0) {
    for (const part of flattenBodyParts(payload, "text/plain")) {
      const text = Buffer.from(part.body!.data!, "base64url").toString("utf-8");
      for (const match of text.matchAll(BARE_URL_RE)) hrefs.add(match[0]);
    }
  }

  const drive: { url: string; name: string }[] = [];
  for (const href of hrefs) {
    const classified = classifyLink(href);
    if (classified?.type === "drive") drive.push({ url: classified.url, name: classified.name });
  }
  return drive;
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
    // Same tile / poster an upload gets (best-effort: null just means none).
    const thumbnailUrl = await thumbnailForUpload(classified.type, UPLOAD_DIR, storedName, bytes);

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
      thumbnailUrl,
    });
    added++;
  }

  // Files too big for Gmail's 25MB attachment cap arrive as a Drive share
  // link in the body instead of a real attachment part — same treatment,
  // just no bytes to write locally (the asset just points at the Drive URL).
  for (const { url, name } of extractDriveLinksFromBody(res.data.payload)) {
    await createMediaAsset({
      type: "drive",
      url,
      name: name || subject || "Email attachment",
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

/** Gmail's `after:`/`before:` search operators only support day granularity
 * (YYYY/MM/DD), not a real timestamp — this rounds DOWN to the start of the
 * given date's calendar day (never up), so a message ingested at 11pm isn't
 * silently excluded by a same-day boundary on the next incremental load. The
 * resulting one-day overlap is harmless: isMessageIngested skips anything
 * already processed. */
function toGmailAfterQuery(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

/**
 * On-demand load, triggered by the "Load Email" button (see
 * apps/api/src/routes/media.ts POST /media/gmail/load). Not a background
 * poll — nothing happens with the mailbox except when this is called.
 *
 * Incremental: picks up right where the last successful load left off
 * (getLastGmailIngestTimestamp, the newest processedAt across every message
 * ever ingested) rather than always re-querying a fixed rolling window — a
 * fixed `newer_than:Nd` window would silently miss anything older than N
 * days if nobody clicks Load Email for a while. `days` is only the
 * first-run bootstrap window, before anything has ever been ingested.
 */
export async function runGmailLoad(days = 2): Promise<{ added: number }> {
  if (!gmailClient) {
    throw new Error("Gmail ingest is not configured (GMAIL_INGEST_ENABLED/GMAIL_IMPERSONATE_USER/service account key)");
  }
  const gmail = gmailClient;

  const lastIngestedAt = await getLastGmailIngestTimestamp();
  const query = lastIngestedAt ? `after:${toGmailAfterQuery(lastIngestedAt)}` : `newer_than:${days}d`;

  // Gmail returns messages newest-first. Collect ids across every page before
  // processing any of them, then walk the full list oldest-to-newest so each
  // createMediaAsset() insert (createdAt = now()) lands in the same order as
  // the emails themselves. Processing newest-first would insert the newest
  // email first — giving it the *earliest* timestamp of the batch — and the
  // oldest email last with the *latest* timestamp, inverting the
  // newest-first sort listMediaAssets relies on (packages/db/src/queries/media.ts).
  const messageIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const list = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 50,
      pageToken,
    });

    for (const message of list.data.messages ?? []) {
      if (!message.id || messageIds.length >= MAX_MESSAGES_PER_LOAD) break;
      messageIds.push(message.id);
    }

    pageToken = list.data.nextPageToken ?? undefined;
  } while (pageToken && messageIds.length < MAX_MESSAGES_PER_LOAD);

  let added = 0;
  for (const messageId of messageIds.reverse()) {
    try {
      if (await isMessageIngested(messageId)) continue;
      added += await processMessage(gmail, messageId);
    } catch (err) {
      console.error(`[gmail-ingest] failed to process message ${messageId}:`, err);
    }
  }

  return { added };
}
