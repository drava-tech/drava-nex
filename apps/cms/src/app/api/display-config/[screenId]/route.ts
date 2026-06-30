import { NextResponse } from "next/server";
import type { WsContent } from "@platform/types";

// Server-side base URL for reaching the API gateway (http://api:4000 in Docker).
const INTERNAL_API_URL = process.env["INTERNAL_API_URL"] ?? "http://localhost:4000";

/**
 * Same-origin proxy to the API's DB-authoritative screen config. The screen
 * client fetches this on every WS (re)connect to converge on current content.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ screenId: string }> }
) {
  const { screenId } = await params;

  try {
    const res = await fetch(
      `${INTERNAL_API_URL}/api/screens/${encodeURIComponent(screenId)}/config`,
      { cache: "no-store" }
    );
    if (res.status === 404) return jsonNoStore({ content: null }, 404);
    if (!res.ok) return jsonNoStore({ content: null }, 502);
    const data = (await res.json()) as { content: WsContent | null };
    return jsonNoStore({ content: data.content ?? null });
  } catch {
    return jsonNoStore({ content: null }, 502);
  }
}

function jsonNoStore(body: { content: WsContent | null }, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
