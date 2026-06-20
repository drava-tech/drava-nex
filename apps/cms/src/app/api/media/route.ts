import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const dynamic = 'force-dynamic';

const INITIAL_MEDIA: any[] = [];

export async function GET() {
  try {
    const mediaDir = path.join(process.cwd(), "public", "media");
    const metadataPath = path.join(mediaDir, "metadata.json");

    // Ensure media folder exists
    await fs.mkdir(mediaDir, { recursive: true });

    let metadata: any[] = [];
    try {
      const existingData = await fs.readFile(metadataPath, "utf-8");
      metadata = JSON.parse(existingData);
      if (!Array.isArray(metadata)) {
        metadata = INITIAL_MEDIA;
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
      }
    } catch {
      // Initialize with mock items on first run
      metadata = INITIAL_MEDIA;
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    }

    return NextResponse.json({ media: metadata });
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

    const mediaDir = path.join(process.cwd(), "public", "media");
    const metadataPath = path.join(mediaDir, "metadata.json");

    let metadata: any[] = [];
    try {
      const existingData = await fs.readFile(metadataPath, "utf-8");
      metadata = JSON.parse(existingData);
    } catch {
      return NextResponse.json({ error: "Metadata file not found" }, { status: 404 });
    }

    const itemToDelete = metadata.find((item) => item.id === id);
    if (!itemToDelete) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }

    // If it's a locally uploaded file, delete it from disk
    if (itemToDelete.url.startsWith("/media/")) {
      const filename = itemToDelete.name;
      const filePath = path.join(mediaDir, filename);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        console.warn(`Could not delete file ${filePath} from disk:`, err);
      }
    }

    // Filter out item from metadata list
    const updatedMetadata = metadata.filter((item) => item.id !== id);
    await fs.writeFile(metadataPath, JSON.stringify(updatedMetadata, null, 2), "utf-8");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete media failed:", error);
    return NextResponse.json({ error: error.message || "Failed to delete media" }, { status: 500 });
  }
}
