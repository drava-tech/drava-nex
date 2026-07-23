import { Hono } from "hono";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { createMediaAsset, listMediaAssets, getMediaAsset, softDeleteMediaAsset, type MediaAsset } from "@platform/db";
import { requireAdmin, requireGuestOrAdmin } from "../middleware/auth.js";

// Uploaded files live on a Docker volume mounted only into this (api) container
// (see infra/docker/docker-compose.yml) and are served at /media/* by
// mediaFilesRouter below — nginx proxies /media/ here, not to the CMS.
const UPLOAD_DIR = process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), "../../apps/cms/public/media");

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
};

/** Classify an upload by extension + MIME against the allowlist; null = rejected. */
function classifyUpload(fileName: string, mime: string): { type: string; ext: string } | null {
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
  const bytes = a.sizeBytes ?? 0;
  const size =
    bytes > 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${(bytes / 1024).toFixed(1)} KB`;
  const date = new Date(a.createdAt).toLocaleDateString("en-US", {
    month: "short", day: "2-digit", year: "numeric",
  });
  return { id: a.id, name: a.name, type: a.type, url: a.url, size, date };
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".ogg": "video/ogg", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
    ".webp": "image/webp", ".avif": "image/avif",
  };
  return map[ext] ?? "application/octet-stream";
}

export const mediaRouter = new Hono();

// --- Reads ---

// GET /api/media — list all media assets
mediaRouter.get("/", requireGuestOrAdmin, async (c) => {
  try {
    const assets = await listMediaAssets();
    return c.json({ media: assets.map(toMediaItem) });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Failed to list media" }, 500);
  }
});

// --- Delete ---

// DELETE /api/media?id=<id>
mediaRouter.delete("/", requireAdmin, async (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ error: "Missing id parameter" }, 400);
  try {
    const asset = await getMediaAsset(id);
    if (!asset) return c.json({ error: "Media item not found" }, 404);
    await softDeleteMediaAsset(id);
    if (asset.url.startsWith("/media/")) {
      const filePath = path.join(UPLOAD_DIR, path.basename(asset.url));
      await fsPromises.unlink(filePath).catch(() => { /* best-effort */ });
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Failed to delete media" }, 500);
  }
});

// POST /api/upload — multipart file upload
export const uploadRouter = new Hono();

type SessionUser = { id: string };

uploadRouter.post("/", requireAdmin, async (c) => {
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
    const bytes = await file.arrayBuffer();
    await fsPromises.writeFile(path.join(UPLOAD_DIR, storedName), Buffer.from(bytes));

    // Preserve a human-friendly display name (sanitized, never used as a path).
    const displayName = file.name.replace(/[^a-zA-Z0-9_.\- ]/g, "_").slice(0, 200) || storedName;

    const uploadedByUserId = (c.get("user" as never) as SessionUser | undefined)?.id;

    const asset = await createMediaAsset({
      type: classified.type,
      url: `/media/${storedName}`,
      name: displayName,
      sizeBytes: file.size,
      ...(uploadedByUserId ? { uploadedByUserId } : {}),
    });

    const size =
      file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
        : `${(file.size / 1024).toFixed(1)} KB`;

    const date = new Date(asset.createdAt).toLocaleDateString("en-US", {
      month: "short", day: "2-digit", year: "numeric",
    });

    return c.json({
      success: true,
      media: { id: asset.id, name: asset.name, type: asset.type, url: asset.url, size, date, selected: false },
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
function serveMediaFile(c: import("hono").Context, fileName: string): Response {
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
    const stream = fs.createReadStream(resolved, { start, end });
    return new Response(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": mimeType,
      },
    });
  }

  const stream = fs.createReadStream(resolved);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Length": String(fileSize),
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
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

mediaFilesRouter.get("/:filename", async (c) => {
  const fileName = path.basename(c.req.param("filename"));
  return serveMediaFile(c, fileName);
});
