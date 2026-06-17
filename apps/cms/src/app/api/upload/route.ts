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

    // Save to the apps/cms/public folder
    const publicDir = path.join(process.cwd(), "public");
    
    // Ensure directory exists
    await fs.mkdir(publicDir, { recursive: true });

    // Sanitize filename to prevent directory traversal
    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const filePath = path.join(publicDir, safeName);

    // Write file to disk
    await fs.writeFile(filePath, buffer);

    return NextResponse.json({
      success: true,
      filename: safeName,
      url: `/${safeName}`,
    });
  } catch (error: any) {
    console.error("Local file upload failed:", error);
    return NextResponse.json({ error: error.message || "Upload failed" }, { status: 500 });
  }
}
