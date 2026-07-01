import { Hono } from "hono";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { createMediaAsset, listMediaAssets, getMediaAsset, softDeleteMediaAsset, type MediaAsset } from "@platform/db";
import { requireAdmin, requireGuestOrAdmin } from "../middleware/auth.js";

// ponytail: files stay in the CMS public/media dir so Next.js serves them as
// static assets at /media/*. This avoids needing a separate Hono static-file
// route and keeps URLs unchanged.
const UPLOAD_DIR = process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), "../../apps/cms/public/media");

// Max upload size (bytes). Generous default for signage video; tune via env.
const MAX_UPLOAD_BYTES = Number(process.env["MAX_UPLOAD_BYTES"] ?? 1024 * 1024 * 1024); // 1 GiB

// Allowlist of accepted upload kinds. SVG is intentionally excluded (stored-XSS
// risk when served same-origin). Anything not matched here is rejected.
const ALLOWED: Record<string, { mimes: string[]; exts: string[] }> = {
  image: { mimes: ["image/png", "image/jpeg", "image/gif", "image/webp"], exts: [".png", ".jpg", ".jpeg", ".gif", ".webp"] },
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
    ".webp": "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

export const mediaRouter = new Hono();

// GET /api/media — list all media assets
mediaRouter.get("/", requireGuestOrAdmin, async (c) => {
  try {
    const assets = await listMediaAssets();
    return c.json({ media: assets.map(toMediaItem) });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Failed to list media" }, 500);
  }
});

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

// GET /api/media/stream?id=<mediaId> | ?file=<filename> — range-aware streaming.
// Files are ALWAYS resolved within UPLOAD_DIR; arbitrary absolute paths are
// rejected (prevents path-traversal / local-file disclosure).
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

  const baseDir = path.resolve(UPLOAD_DIR);
  const resolved = path.resolve(baseDir, fileName);
  // Containment guard — resolved must stay inside UPLOAD_DIR.
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!fs.existsSync(resolved)) {
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
});
