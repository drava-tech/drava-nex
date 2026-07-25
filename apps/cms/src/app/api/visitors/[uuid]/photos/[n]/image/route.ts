import { headers } from "next/headers";
import type { NextRequest } from "next/server";

// Same-origin proxy for a visitor's captured face crops (one per photo_number),
// mirroring ../../../image/route.ts. The browser <img> can't attach the session
// cookie to the Hono API's origin, so this forwards it server-side and streams
// the JPEG back (the API enforces admin auth).
const API_BASE = process.env["INTERNAL_API_URL"] ?? "http://localhost:4000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ uuid: string; n: string }> }
) {
  const { uuid, n } = await params;
  const cookie = (await headers()).get("cookie") ?? "";

  let upstream: Response;
  try {
    upstream = await fetch(
      `${API_BASE}/api/visitors/${encodeURIComponent(uuid)}/photos/${encodeURIComponent(n)}/image`,
      { headers: { cookie }, cache: "no-store" }
    );
  } catch {
    return new Response("API unreachable", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("Not found", { status: upstream.status || 404 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "private, max-age=300",
    },
  });
}
