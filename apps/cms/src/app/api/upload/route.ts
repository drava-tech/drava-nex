import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

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

    // Metadata details
    const id = `m${Date.now()}`;
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

    const dateOptions: Intl.DateTimeFormatOptions = { month: "short", day: "2-digit", year: "numeric" };
    const date = new Date().toLocaleDateString("en-US", dateOptions);

    const newItem = {
      id,
      name: safeName,
      type,
      url: `/media/${safeName}`,
      size,
      date,
      selected: false
    };

    // Update metadata.json
    const metadataPath = path.join(mediaDir, "metadata.json");
    let metadata: any[] = [];
    try {
      const existingData = await fs.readFile(metadataPath, "utf-8");
      metadata = JSON.parse(existingData);
      if (!Array.isArray(metadata)) {
        metadata = [];
      }
    } catch {
      metadata = [];
    }

    metadata.push(newItem);
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");

    return NextResponse.json({
      success: true,
      media: newItem,
    });
  } catch (error: any) {
    console.error("Local file upload failed:", error);
    return NextResponse.json({ error: error.message || "Upload failed" }, { status: 500 });
  }
}
