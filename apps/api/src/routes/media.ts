import { Hono } from "hono";
import fs from "fs";
import fsPromises from "fs/promises";
import { Readable } from "node:stream";
import path from "path";
import { randomUUID } from "crypto";
import { createMediaAsset, listMediaAssets, listMediaAssetsCursor, getMediaLibraryStats, getMediaAsset, softDeleteMediaAsset, markMediaSaved, isMediaOwnedBy, type MediaAsset, type MediaOwner } from "@platform/db";
import { classifyLink, listMediaQuerySchema } from "@platform/types";
import { requireGuestOrAdmin, type SessionUser as AuthUser } from "../middleware/auth.js";
import { runGmailLoad } from "../services/gmail-ingest.js";
import { thumbnailForUpload } from "../services/thumbnails.js";
import { videoLengthSeconds } from "../services/video-length.js";
import { broadcastToCms } from "../ws/gateway.js";

// Uploaded files live on a Docker volume mounted only into this (api) container
// (see infra/docker/docker-compose.yml) and are served at /media/* by
// mediaFilesRouter below — nginx proxies /media/ here, not to the CMS.
export const UPLOAD_DIR = process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), "../../apps/cms/public/media");

// Static "seed" assets baked into the repo (default template imagery, demo
// video) — in dev this is the SAME folder as UPLOAD_DIR above, but in Docker
// prod UPLOAD_DIR is a separate persistent volume, so these wouldn't otherwise
// be reachable at /media/* (the CMS image bakes its own copy of this folder,
// but nginx routes /media/ to this api container, not the CMS — see
// infra/nginx/default.conf). The Dockerfile copies apps/cms/public/media here
// so this default path resolves inside the container too.
const SEED_MEDIA_DIR = process.env["SEED_MEDIA_DIR"] ?? path.join(process.cwd(), "../../apps/cms/public/media");

// Max upload size (bytes). Generous default for signage video; tune via env.
const MAX_UPLOAD_BYTES = Number(process.env["MAX_UPLOAD_BYTES"] ?? 1024 * 1024 * 1024); // 1 GiB

// Allowlist of accepted upload kinds. SVG is intentionally excluded (stored-XSS
// risk when served same-origin). Anything not matched here is rejected.
const ALLOWED: Record<string, { mimes: string[]; exts: string[] }> = {
  image: { mimes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"], exts: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"] },
  video: { mimes: ["video/mp4", "video/webm", "video/ogg", "video/quicktime"], exts: [".mp4", ".webm", ".ogg", ".mov", ".m4v"] },
  document: { mimes: ["application/pdf"], exts: [".pdf"] },
  // Legacy binary .xls is intentionally excluded — the spreadsheet viewer
  // (apps/cms/src/app/display/sheet) reads .xlsx and .csv only, and accepting a
  // file we can't display would just fail later, on a screen.
  sheet: {
    mimes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/csv",
    ],
    exts: [".xlsx", ".csv"],
  },
  // Legacy binary .ppt is excluded for the same reason as .xls above: the slide
  // viewer (apps/cms/src/app/display/slides) reads the Open XML .pptx zip only.
  presentation: {
    mimes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    exts: [".pptx"],
  },
  // Legacy binary .doc is excluded for the same reason — the word viewer
  // (apps/cms/src/app/display/word) uses mammoth, which only reads .docx.
  word: {
    mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    exts: [".docx"],
  },
};

/** Classify an upload by extension + MIME against the allowlist; null = rejected. */
export function classifyUpload(fileName: string, mime: string): { type: string; ext: string } | null {
  const ext = path.extname(fileName).toLowerCase();
  const mimeLower = (mime || "").toLowerCase();
  for (const [type, rule] of Object.entries(ALLOWED)) {
    if (rule.exts.includes(ext) && (rule.mimes.includes(mimeLower) || mimeLower === "" || mimeLower === "application/octet-stream")) {
      return { type, ext };
    }
  }
  return null;
}

function toMediaItem(a: MediaAsset) {
  const bytes = a.sizeBytes;
  // Link assets (YouTube/Drive/web pages) have no file, so no size to report.
  const size =
    bytes == null ? "—"
    : bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
  const date = new Date(a.createdAt).toLocaleDateString("en-US", {
    month: "short", day: "2-digit", year: "numeric",
  });
  return {
    id: a.id, name: a.name, type: a.type, url: a.url, size, sizeBytes: bytes, date,
    // Raw ISO timestamp alongside the display-formatted `date` above — the
    // CMS's date-range filter needs a real comparable value, not a
    // locale-formatted string.
    createdAt: new Date(a.createdAt).toISOString(),
    source: a.source, emailFrom: a.emailFrom, emailSubject: a.emailSubject,
    pendingSave: a.pendingSave,
    // Null for videos, links, and any image predating the backfill — consumers
    // resolve the fallback with mediaThumbnailSrc().
    thumbnailUrl: a.thumbnailUrl,
  };
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".ogg": "video/ogg", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
    ".webp": "image/webp", ".avif": "image/avif",
    // PDFs must carry their real type or the browser downloads them instead of
    // rendering them in the display iframe.
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    // 3D template assets (see STATIC_ASSET_DIRS below).
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".wasm": "application/wasm",
    ".js": "text/javascript",
  };
  return map[ext] ?? "application/octet-stream";
}

export const mediaRouter = new Hono();

/**
 * Whose media this request may see. A User (GUEST) has their own library —
 * what they uploaded, plus emails they sent from their own address — and
 * starts with an empty one; admins and the super admin see everything.
 */
function ownerOf(c: { get: (key: never) => unknown }): MediaOwner | null {
  const u = c.get("user" as never) as AuthUser | undefined;
  return u && u.role === "GUEST" ? { userId: u.id, email: u.email } : null;
}

/** For a User, someone else's media is "not found": its existence isn't theirs to know. */
function hiddenFrom(c: { get: (key: never) => unknown }, asset: Parameters<typeof isMediaOwnedBy>[0]): boolean {
  const owner = ownerOf(c);
  return owner !== null && !isMediaOwnedBy(asset, owner);
}

// --- Reads ---

// GET /api/media — paginated media listing, in one of two modes:
//
//   offset (default)  ?page=&pageSize=      → { media, total, page, pageSize }
//   cursor            ?mode=cursor&cursor=&limit=  → { media, nextCursor }
//
// Cursor mode is what /broadcast's carousel uses: it scrolls forward through a
// list that gains rows at the head (Gmail ingest, MEDIA_LIBRARY_UPDATED), and
// an offset window would repeat or skip cards every time that happens.
//
// Filters (search, types, sources, dateFrom, dateTo) apply identically to both.
// The response key stays `media` — this route is one of the legacy ad-hoc
// shapes deliberately kept out of the {success,data} envelope so always-on
// display clients don't break (see apps/api/src/lib/response.ts).
mediaRouter.get("/", requireGuestOrAdmin, async (c) => {
  try {
    const raw = { ...c.req.query() };
    // Legacy alias: ?source=email was the single-value form of ?sources=.
    if (raw["source"] && !raw["sources"]) raw["sources"] = raw["source"];

    const parsed = listMediaQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid media query", details: parsed.error.issues }, 400);
    }
    const query = parsed.data;

    if (query.mode === "cursor") {
      const { items, nextCursor } = await listMediaAssetsCursor(query, ownerOf(c));
      return c.json({ media: items.map(toMediaItem), nextCursor });
    }

    const { items, total, page, pageSize } = await listMediaAssets(query, ownerOf(c));
    return c.json({ media: items.map(toMediaItem), total, page, pageSize });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Failed to list media" }, 500);
  }
});

// GET /api/media/stats — whole-library aggregates for the dashboard media
// cards (total count, bytes stored, per-type ratio, additions this week, and
// the newest few uploads).
//
// These are library-wide figures, so they cannot be derived from a page of the
// listing above. This exists so the dashboard stops downloading every media row
// on mount, on every WS reconnect and on every browser tab focus just to sum
// sizeBytes in the browser — COUNT/SUM/GROUP BY return a handful of rows here
// however large the library gets.
mediaRouter.get("/stats", requireGuestOrAdmin, async (c) => {
  try {
    // Same filter set as the listing, so /broadcast can ask "which media types
    // exist under my current source/date filter?" and get an answer that agrees
    // with the rows the listing will hand it.
    const parsed = listMediaQuerySchema.safeParse({ ...c.req.query() });
    if (!parsed.success) {
      return c.json({ error: "Invalid media query", details: parsed.error.issues }, 400);
    }
    const stats = await getMediaLibraryStats(parsed.data, 4, ownerOf(c));
    return c.json({
      total: stats.total,
      totalBytes: stats.totalBytes,
      byType: stats.byType,
      recentCount: stats.recentCount,
      recent: stats.recent.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        sizeBytes: r.sizeBytes,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Failed to load media stats" }, 500);
  }
});

// --- Email media (on-demand Gmail load) ---

// POST /api/media/gmail/load — triggered by the "Load Email" button on the
// Media Library page. Not a background job: nothing touches the mailbox
// except when this is called. See services/gmail-ingest.ts.
// Users may run it too: they see only what came from their own address.
mediaRouter.post("/gmail/load", requireGuestOrAdmin, async (c) => {
  try {
    const result = await runGmailLoad(2);
    if (result.added > 0) broadcastToCms({ type: "MEDIA_LIBRARY_UPDATED" });
    return c.json({ success: true, added: result.added });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Failed to load email" }, 503);
  }
});

// --- Link assets ---

// POST /api/media/link — register a pasted URL (YouTube, Drive, or any
// embeddable page) as a media asset. Same row shape as an upload, just with an
// absolute url and no file on disk, so screens/preview/push all work unchanged.
// pendingSave: true (used by the Browser tool's ad-hoc push) hides the row
// from the Media Library listing until explicitly saved via POST /:id/save.
mediaRouter.post("/link", requireGuestOrAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    const rawUrl = typeof body?.url === "string" ? body.url : "";
    if (!rawUrl.trim()) return c.json({ error: "Missing url" }, 400);

    const classified = classifyLink(rawUrl);
    if (!classified) return c.json({ error: "Not a valid http(s) URL" }, 400);

    const customName = typeof body?.name === "string" ? body.name.trim() : "";
    const name = (customName || classified.name).slice(0, 200);
    const pendingSave = body?.pendingSave === true;

    const uploadedByUserId = (c.get("user" as never) as SessionUser | undefined)?.id;

    const asset = await createMediaAsset({
      type: classified.type,
      url: classified.url,
      name,
      pendingSave,
      source: "link",
      ...(uploadedByUserId ? { uploadedByUserId } : {}),
    });

    if (!pendingSave) broadcastToCms({ type: "MEDIA_LIBRARY_UPDATED" });

    return c.json({ success: true, media: toMediaItem(asset) });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Failed to add link" }, 500);
  }
});

// POST /api/media/:id/save — confirms an ad-hoc pushed link is worth keeping,
// making it show up in the Media Library from now on.
mediaRouter.post("/:id/save", requireGuestOrAdmin, async (c) => {
  try {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Missing id" }, 400);
    const asset = await getMediaAsset(id);
    if (!asset || hiddenFrom(c, asset)) return c.json({ error: "Media item not found" }, 404);
    await markMediaSaved(id);
    broadcastToCms({ type: "MEDIA_LIBRARY_UPDATED" });
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Failed to save media" }, 500);
  }
});

// --- Video length ---

/**
 * How long a library video plays, in whole seconds plus one (so its last
 * frame is seen before the next item), read from the file's header. null for
 * anything that isn't a video file this server holds.
 */
export async function libraryVideoSeconds(asset: Pick<MediaAsset, "type" | "url">): Promise<number | null> {
  if (asset.type !== "video" || !asset.url.startsWith("/media/")) return null;
  const rel = asset.url.slice("/media/".length).split("?")[0] ?? "";
  // Stay inside the media folders: no "..", no absolute paths.
  if (!rel || rel.split("/").some((part) => part === ".." || part === "")) return null;
  for (const dir of [UPLOAD_DIR, SEED_MEDIA_DIR]) {
    const seconds = await videoLengthSeconds(path.join(dir, ...rel.split("/")));
    if (seconds) return Math.ceil(seconds) + 1;
  }
  return null;
}

// GET /api/media/:id/length — { seconds } for a video, null if it can't be read
mediaRouter.get("/:id/length", requireGuestOrAdmin, async (c) => {
  const asset = await getMediaAsset(c.req.param("id") ?? "");
  if (!asset || hiddenFrom(c, asset)) return c.json({ error: "Media item not found" }, 404);
  return c.json({ seconds: await libraryVideoSeconds(asset) });
});

// --- Delete ---

// DELETE /api/media?id=<id>
// A User can delete only their own media.
mediaRouter.delete("/", requireGuestOrAdmin, async (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ error: "Missing id parameter" }, 400);
  try {
    const asset = await getMediaAsset(id);
    if (!asset || hiddenFrom(c, asset)) return c.json({ error: "Media item not found" }, 404);
    await softDeleteMediaAsset(id);
    if (asset.url.startsWith("/media/")) {
      const filePath = path.join(UPLOAD_DIR, path.basename(asset.url));
      await fsPromises.unlink(filePath).catch(() => { /* best-effort */ });
    }
    broadcastToCms({ type: "MEDIA_LIBRARY_UPDATED" });
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Failed to delete media" }, 500);
  }
});

// POST /api/upload — multipart file upload
export const uploadRouter = new Hono();

type SessionUser = { id: string };

// Users upload too; the file is recorded as theirs (uploadedByUserId).
uploadRouter.post("/", requireGuestOrAdmin, async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"] as File | undefined;
    if (!file) return c.json({ error: "No file uploaded" }, 400);

    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: `File too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB)` }, 413);
    }

    const classified = classifyUpload(file.name, file.type);
    if (!classified) {
      return c.json({ error: "Unsupported file type" }, 415);
    }

    await fsPromises.mkdir(UPLOAD_DIR, { recursive: true });

    // Server-generated filename — never trust the client name for the path.
    const storedName = `${randomUUID()}${classified.ext}`;
    const destPath = path.join(UPLOAD_DIR, storedName);

    // Buffered, deliberately — NOT `Readable.fromWeb(file.stream())`.
    //
    // That streaming form was tried and reverted: it is the mirror image of the
    // serveMediaFile bug above (see fileWebStream). Consuming an undici File's
    // web stream through Readable.fromWeb leaves undici trying to close a
    // stream the pipeline already finished with, which throws
    // ERR_INVALID_STATE in a microtask and takes the whole process down — and
    // with it every screen in the building.
    //
    // Buffering costs memory, but the arithmetic is comfortable: the container
    // is capped at 4 GB with --max-old-space-size=3072 against a 1 GiB upload
    // ceiling, so a large upload fails its own request instead of the process.
    // Genuinely streaming this needs a real multipart parser (busboy), not
    // file.stream() — worth doing only if uploads actually grow.
    const buffer = Buffer.from(await file.arrayBuffer());
    await fsPromises.writeFile(destPath, buffer);

    // Preserve a human-friendly display name (sanitized, never used as a path).
    const displayName = file.name.replace(/[^a-zA-Z0-9_.\- ]/g, "_").slice(0, 200) || storedName;

    const uploadedByUserId = (c.get("user" as never) as SessionUser | undefined)?.id;

    // Images get a small WebP tile so the media grid and the broadcast carousel
    // stop downloading multi-megabyte originals to paint ~200px thumbnails.
    // Best-effort by contract: null here just means consumers fall back to the
    // original, so a sharp failure can never cost the user their upload. Done
    // before the insert so the row is written once, already complete.
    // Videos get a poster frame the same way (ffmpeg), so they have a picture too.
    const thumbnailUrl = await thumbnailForUpload(classified.type, UPLOAD_DIR, storedName, buffer);

    const asset = await createMediaAsset({
      type: classified.type,
      url: `/media/${storedName}`,
      name: displayName,
      sizeBytes: file.size,
      source: "upload",
      thumbnailUrl,
      ...(uploadedByUserId ? { uploadedByUserId } : {}),
    });
    broadcastToCms({ type: "MEDIA_LIBRARY_UPDATED" });

    const size =
      file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
        : `${(file.size / 1024).toFixed(1)} KB`;

    const date = new Date(asset.createdAt).toLocaleDateString("en-US", {
      month: "short", day: "2-digit", year: "numeric",
    });

    return c.json({
      success: true,
      media: {
        id: asset.id, name: asset.name, type: asset.type, url: asset.url, size, sizeBytes: asset.sizeBytes, date,
        createdAt: new Date(asset.createdAt).toISOString(),
        source: asset.source, selected: false,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Upload failed" }, 500);
  }
});

// Resolves fileName within dir, guarding against traversal escaping it.
// Returns null if the containment check fails OR the file doesn't exist there.
function resolveWithin(dir: string, fileName: string): string | null {
  const baseDir = path.resolve(dir);
  const resolved = path.resolve(baseDir, fileName);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

// Shared range-aware file responder. Checks UPLOAD_DIR (runtime uploads) first,
// then falls back to SEED_MEDIA_DIR (baked-in template imagery) — both are
// addressed by the same /media/<file> URL scheme.
/**
 * A file as a real web ReadableStream, safe to hand to `Response`.
 *
 * This used to be `new Response(fs.createReadStream(p) as unknown as ReadableStream)`.
 * That cast silenced the type error without fixing anything: `Response` here is
 * undici's, and it expects a WEB stream, not a Node one. When a client aborted
 * mid-response — which an Android <video> does constantly as it scrubs and as
 * tiles scroll out of view — undici tried to close a controller the Node stream
 * had already ended and threw ERR_INVALID_STATE from inside a microtask, where
 * nothing can catch it. The process exited.
 *
 * That was not theoretical: it crashed the API 46 times in one day, and because
 * the API reset every screen to idle on boot, each crash blanked every screen in
 * the building — including one mid-presentation.
 *
 * `Readable.toWeb` produces a genuine web stream, and its `cancel()` destroys the
 * underlying handle, so an aborted request closes the fd instead of leaking it.
 */
function fileWebStream(
  filePath: string,
  range?: { start: number; end: number }
): ReadableStream<Uint8Array> {
  const nodeStream = range
    ? fs.createReadStream(filePath, { start: range.start, end: range.end })
    : fs.createReadStream(filePath);
  // A read error (file deleted mid-stream, disk issue) must not become an
  // unhandled 'error' event on the raw stream either — surface it through the
  // web stream so the request fails instead of the process.
  nodeStream.on("error", () => nodeStream.destroy());
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

function serveMediaFile(
  c: import("hono").Context,
  fileName: string,
  cacheControl?: string
): Response {
  const resolved = resolveWithin(UPLOAD_DIR, fileName) ?? resolveWithin(SEED_MEDIA_DIR, fileName);
  if (!resolved) {
    return new Response("File not found", { status: 404 });
  }

  const stat = fs.statSync(resolved);
  const fileSize = stat.size;
  const mimeType = getMimeType(resolved);
  const range = c.req.header("range");

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr ?? "0", 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    if (start >= fileSize || end >= fileSize) {
      return new Response("Requested range not satisfiable", {
        status: 416, headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }
    return new Response(fileWebStream(resolved, { start, end }), {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": mimeType,
        // Must be set on the 206 path too, not just the full-file one below:
        // a <video> element fetches almost exclusively by range, so a
        // cache-control that only covers 200 responses never applies to the
        // content that actually benefits from it.
        ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
      },
    });
  }

  return new Response(fileWebStream(resolved), {
    headers: {
      "Content-Length": String(fileSize),
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
      ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
    },
  });
}

// GET /api/media/stream?id=<mediaId> | ?file=<filename> — range-aware streaming.
export const mediaStreamRouter = new Hono();

mediaStreamRouter.get("/", async (c) => {
  const id = c.req.query("id");
  // Accept legacy `path`/`file` params but only ever honor the basename.
  const fileParam = c.req.query("file") ?? c.req.query("path");

  let fileName: string | null = null;
  if (id) {
    const asset = await getMediaAsset(id);
    if (!asset) return new Response("File not found", { status: 404 });
    fileName = path.basename(asset.url);
  } else if (fileParam) {
    fileName = path.basename(fileParam);
  }
  if (!fileName) return new Response("Missing id or file parameter", { status: 400 });

  return serveMediaFile(c, fileName);
});

// GET /media/:filename — the canonical public URL every MediaAsset.url points
// at (e.g. "/media/<uuid>.jpg"). Public/unauthenticated: TV displays load
// images/video with no session, same as /display.
export const mediaFilesRouter = new Hono();

// Uploaded files are stored under a freshly-generated uuid name and never
// rewritten in place — a re-upload produces a different URL — so a given
// /media/<uuid>.<ext> is immutable for its whole life, exactly like the
// code-shipped assets below. Without this a signage screen re-downloaded the
// entire file on every push and every reload; for the 150 MB clips in this
// library that is the difference between an instant cut and a visible stall.
const UPLOAD_CACHE_CONTROL = "public, max-age=31536000, immutable";

mediaFilesRouter.get("/:filename", async (c) => {
  const fileName = path.basename(c.req.param("filename"));
  return serveMediaFile(c, fileName, UPLOAD_CACHE_CONTROL);
});

// Subdirectories holding large static assets that ship WITH the code (3D models,
// decoders) rather than being uploaded — these can't be flattened into /media/
// because some loaders resolve sibling files by hardcoded name (e.g. three's
// DRACOLoader requests "<decoderPath>draco_wasm_wrapper.js"). Allowlisted rather
// than accepting any depth, so this stays a narrow, auditable exception to the
// otherwise-flat /media/<file> scheme.
const STATIC_ASSET_DIRS = new Set(["flight-garden"]);

// Code-shipped assets are immutable for a given build — a signage screen must
// not re-download tens of MB of geometry on every reload.
const STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

// GET /media/<dir>/<file> and /media/<dir>/<sub>/<file> (one nested level, for
// the DRACO decoder folder). Both segments are basename-sanitized, and
// resolveWithin still enforces containment.
mediaFilesRouter.get("/:dir/:filename", async (c) => {
  const dir = path.basename(c.req.param("dir"));
  if (!STATIC_ASSET_DIRS.has(dir)) return new Response("File not found", { status: 404 });

  const fileName = path.basename(c.req.param("filename"));
  return serveMediaFile(c, `${dir}/${fileName}`, STATIC_ASSET_CACHE_CONTROL);
});

mediaFilesRouter.get("/:dir/:sub/:filename", async (c) => {
  const dir = path.basename(c.req.param("dir"));
  if (!STATIC_ASSET_DIRS.has(dir)) return new Response("File not found", { status: 404 });

  const sub = path.basename(c.req.param("sub"));
  const fileName = path.basename(c.req.param("filename"));
  return serveMediaFile(c, `${dir}/${sub}/${fileName}`, STATIC_ASSET_CACHE_CONTROL);
});
