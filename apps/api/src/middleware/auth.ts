import type { Context, Next } from "hono";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "GUEST" | "SUPERADMIN";
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

async function verifySession(c: Context): Promise<SessionUser | null> {
  const cookieHeader = c.req.header("cookie") ?? "";
  if (!cookieHeader) return null;

  try {
    // The CMS app (Next.js) exposes the better-auth endpoints.
    // By querying it directly, we guarantee 100% compatibility with any token format/hashing.
    const authUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
    const res = await fetch(`${authUrl}/api/auth/get-session`, {
      headers: { cookie: cookieHeader },
    });

    if (!res.ok) return null;
    const body = await res.json();
    return (body?.user as SessionUser) ?? null;
  } catch (err) {
    console.error("Failed to verify session via better-auth endpoint:", err);
    return null;
  }
}

import { fail } from "../lib/response.js";

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const currentUser = await verifySession(c);
  if (!currentUser) return fail(c, "UNAUTHORIZED", "Unauthorized", 401);
  c.set("user", currentUser);
  return next();
}

export async function requireAdmin(c: Context, next: Next): Promise<Response | void> {
  const currentUser = await verifySession(c);
  if (!currentUser) return fail(c, "UNAUTHORIZED", "Unauthorized", 401);
  if (currentUser.role !== "ADMIN" && currentUser.role !== "SUPERADMIN") {
    return fail(c, "FORBIDDEN", "Forbidden", 403);
  }
  c.set("user", currentUser);
  return next();
}

export async function requireGuestOrAdmin(c: Context, next: Next): Promise<Response | void> {
  const currentUser = await verifySession(c);
  if (!currentUser) return fail(c, "UNAUTHORIZED", "Unauthorized", 401);
  if (
    currentUser.role !== "ADMIN" &&
    currentUser.role !== "GUEST" &&
    currentUser.role !== "SUPERADMIN"
  ) {
    return fail(c, "FORBIDDEN", "Forbidden", 403);
  }
  c.set("user", currentUser);
  return next();
}
