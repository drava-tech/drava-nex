import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

// Helper to convert Node.js ReadStream to Web ReadableStream
function nodeStreamToWeb(nodeStream: fs.ReadStream): ReadableStream {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => {
        controller.enqueue(chunk);
      });
      nodeStream.on("end", () => {
        controller.close();
      });
      nodeStream.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    }
  });
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".mov": return "video/quicktime";
    case ".ogg": return "video/ogg";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".svg": return "image/svg+xml";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filePath = searchParams.get("path");

    if (!filePath) {
      return new Response("Missing path parameter", { status: 400 });
    }

    // Resolve path
    const resolvedPath = path.resolve(filePath);

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return new Response(`File not found: ${resolvedPath}`, { status: 404 });
    }

    const stat = fs.statSync(resolvedPath);
    const fileSize = stat.size;
    const range = req.headers.get("range");
    const mimeType = getMimeType(resolvedPath);

    // Handle range requests for video playback seeking/looping
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const startStr = parts[0] || "0";
      const start = parseInt(startStr, 10);
      const endStr = parts[1];
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        return new Response("Requested range not satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` }
        });
      }

      const chunksize = (end - start) + 1;
      const fileStream = fs.createReadStream(resolvedPath, { start, end });
      const webStream = nodeStreamToWeb(fileStream);

      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize.toString(),
          "Content-Type": mimeType,
        }
      });
    } else {
      const fileStream = fs.createReadStream(resolvedPath);
      const webStream = nodeStreamToWeb(fileStream);

      return new Response(webStream, {
        status: 200,
        headers: {
          "Content-Length": fileSize.toString(),
          "Content-Type": mimeType,
          "Accept-Ranges": "bytes"
        }
      });
    }
  } catch (error: any) {
    console.error("Local file stream failed:", error);
    return new Response(error.message || "Internal server error", { status: 500 });
  }
}
