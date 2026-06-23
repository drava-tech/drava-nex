import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { listMediaAssets, getMediaAsset, softDeleteMediaAsset, type MediaAsset } from "@platform/db";

export const dynamic = "force-dynamic";

/** Format a media_asset DB row into the shape the media UI/pickers expect. */
function toMediaItem(a: MediaAsset) {
  const bytes = a.sizeBytes ?? 0;
  const size = bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
  const date = new Date(a.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
  return { id: a.id, name: a.name, type: a.type, url: a.url, size, date };
}

export async function GET() {
  try {
    const assets = await listMediaAssets();
    return NextResponse.json({ media: assets.map(toMediaItem) });
  } catch (error: any) {
    console.error("List media failed:", error);
    return NextResponse.json({ error: error.message || "Failed to list media" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
    }

    const asset = await getMediaAsset(id);
    if (!asset) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }

    await softDeleteMediaAsset(id);

    // Best-effort: remove the underlying file for locally-stored uploads.
    if (asset.url.startsWith("/media/")) {
      const filename = path.basename(asset.url);
      const filePath = path.join(process.cwd(), "public", "media", filename);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        console.warn(`Could not delete file ${filePath} from disk:`, err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete media failed:", error);
    return NextResponse.json({ error: error.message || "Failed to delete media" }, { status: 500 });
  }
}
