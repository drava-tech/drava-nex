import { Hono } from "hono";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { createMediaAsset, listMediaAssets, getMediaAsset, softDeleteMediaAsset, type MediaAsset } from "@platform/db";

// ponytail: files stay in the CMS public/media dir so Next.js serves them as
// static assets at /media/*. This avoids needing a separate Hono static-file
// route and keeps URLs unchanged.
const UPLOAD_DIR = process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), "../../apps/cms/public/media");

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
mediaRouter.get("/", async (c) => {
  try {
    const assets = await listMediaAssets();
    return c.json({ media: assets.map(toMediaItem) });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Failed to list media" }, 500);
  }
});

// DELETE /api/media?id=<id>
mediaRouter.delete("/", async (c) => {
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

uploadRouter.post("/", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"] as File | undefined;
    if (!file) return c.json({ error: "No file uploaded" }, 400);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    await fsPromises.mkdir(UPLOAD_DIR, { recursive: true });

    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
    await fsPromises.writeFile(path.join(UPLOAD_DIR, safeName), buffer);

    let type = "document";
    const nameLower = file.name.toLowerCase();
    if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(nameLower)) {
      type = "image";
    } else if (file.type.startsWith("video/") || /\.(mp4|webm|ogg|mov|m4v|avi|mkv)$/i.test(nameLower)) {
      type = "video";
    }

    const asset = await createMediaAsset({
      type, url: `/media/${safeName}`, name: safeName, sizeBytes: file.size,
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

// GET /api/media/stream?path=<absolute-path> — range-aware file streaming
export const mediaStreamRouter = new Hono();

mediaStreamRouter.get("/", async (c) => {
  const filePath = c.req.query("path");
  if (!filePath) return new Response("Missing path parameter", { status: 400 });

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return new Response(`File not found: ${resolved}`, { status: 404 });
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
