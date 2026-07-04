import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/403"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Pass through public paths, APIs, WebSockets, health checks, and Next.js internals
  // ponytail: bypassed /api/ and /ws/ so Next.js dev server proxy rewrites can reach the Hono backend without getting redirected to /login.
  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/ws") ||
    pathname === "/health" ||
    pathname === "/display" ||
    pathname.startsWith("/display/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Check for the Better Auth session cookie (lightweight presence check only).
  // Full session validity + role enforcement happens in each page's requireAuth() call.
  const sessionCookie =
    request.cookies.get("better-auth.session_token") ??
    request.cookies.get("__Secure-better-auth.session_token");

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
