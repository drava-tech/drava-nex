import { NextResponse } from "next/server";

/**
 * `/broadcast/live` has no page of its own — it's only ever reached by clicking
 * the "Live" crumb on `/broadcast/live/<deviceId>` — so bounce it to the board.
 *
 * The Location is deliberately relative. Behind nginx the standalone server
 * binds 0.0.0.0:3000 (see apps/cms/Dockerfile), and a Route Handler's
 * `request.url` reports that internal bind address rather than the address the
 * browser used — so `new URL("/broadcast", request.url)` used to redirect
 * people to an unreachable `https://0.0.0.0:3000/broadcast`. A relative
 * Location is resolved by the browser against whatever origin it actually
 * requested, so it stays correct under nginx, in dev, and on any hostname.
 */
export async function GET() {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: "/broadcast" },
  });
}
