import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/403"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Pass through public paths and Next.js internals
  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/api/auth") ||
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
