import { NextResponse } from "next/server";

export async function GET() {
  const apiUrl = process.env["INTERNAL_API_URL"] ?? "http://localhost:4000";
  try {
    const res = await fetch(`${apiUrl}/api/projects`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ verticals: [] });
  }
}
