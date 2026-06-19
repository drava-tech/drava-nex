import { NextResponse } from "next/server";
import { readContentsJson } from "@/lib/config-writer";

export async function GET() {
  try {
    const config = await readContentsJson();
    return NextResponse.json(config);
  } catch {
    return NextResponse.json({ contents: [] });
  }
}
