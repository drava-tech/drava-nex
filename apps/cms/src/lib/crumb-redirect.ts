import { NextResponse } from "next/server";

/**
 * 307 to `path`, for a URL segment that has no page of its own.
 *
 * The dashboard breadcrumb (see _components/dashboard-breadcrumb.tsx) turns
 * EVERY prefix of the current path into a link, so an intermediate segment
 * with no page.tsx renders as a crumb that 404s — /media/live under
 * /media/live/<deviceId>, say. Each such segment gets a route handler that
 * bounces to its nearest real ancestor, so every crumb in every trail leads
 * somewhere, and so does the bare URL if someone types or bookmarks it.
 *
 * The Location is deliberately RELATIVE. Behind nginx the standalone server
 * binds 0.0.0.0:3000 (apps/cms/Dockerfile), and a Route Handler's
 * `request.url` reports that internal bind address rather than the address the
 * browser used — so building an absolute URL from it sent people to an
 * unreachable https://0.0.0.0:3000/... A relative Location is resolved by the
 * browser against the origin it actually requested, so it stays correct behind
 * nginx, in dev, over http or https, on any hostname.
 */
export function crumbRedirect(path: string) {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: path },
  });
}
