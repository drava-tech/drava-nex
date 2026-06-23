import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { createMediaAsset } from "@platform/db";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Save to the apps/cms/public/media folder
    const mediaDir = path.join(process.cwd(), "public", "media");
    
    // Ensure directory exists
    await fs.mkdir(mediaDir, { recursive: true });

    // Sanitize filename to prevent directory traversal
    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const filePath = path.join(mediaDir, safeName);

    // Write file to disk
    await fs.writeFile(filePath, buffer);

    // Classify by mime/extension.
    let type = "document";
    const nameLower = file.name.toLowerCase();
    if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(nameLower)) {
      type = "image";
    } else if (file.type.startsWith("video/") || /\.(mp4|webm|ogg|mov|m4v|avi|mkv)$/i.test(nameLower)) {
      type = "video";
    }

    const sizeInBytes = file.size;
    const size = sizeInBytes > 1024 * 1024
      ? `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`
      : `${(sizeInBytes / 1024).toFixed(1)} KB`;

    // Persist as a first-class media asset (DB-backed library).
    const asset = await createMediaAsset({
      type,
      url: `/media/${safeName}`,
      name: safeName,
      sizeBytes: sizeInBytes,
    });

    const date = new Date(asset.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });

    return NextResponse.json({
      success: true,
      media: {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        url: asset.url,
        size,
        date,
        selected: false,
      },
    });
  } catch (error: any) {
    console.error("Local file upload failed:", error);
    return NextResponse.json({ error: error.message || "Upload failed" }, { status: 500 });
  }
}
