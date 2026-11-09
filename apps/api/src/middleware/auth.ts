import type { Context, Next } from "hono";
import { auth } from "../lib/auth.js";
import { fail } from "../lib/response.js";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "GUEST" | "SUPERADMIN";
};

/**
 * Resolve the current user from the request, in-process. Better Auth lives in
 * this same app (and the bearer plugin lets `Authorization: Bearer <token>`
 * resolve too), so there is no HTTP round-trip to the CMS.
 */
async function resolveUser(c: Context): Promise<SessionUser | null> {
  try {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result?.user) return null;
    return result.user as unknown as SessionUser;
  } catch (err) {
    console.error("Failed to resolve session:", err);
    return null;
  }
}

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const currentUser = await resolveUser(c);
  if (!currentUser) return fail(c, "UNAUTHORIZED", "Unauthorized", 401);
  c.set("user", currentUser);
  return next();
}

export async function requireAdmin(c: Context, next: Next): Promise<Response | void> {
  const currentUser = await resolveUser(c);
  if (!currentUser) return fail(c, "UNAUTHORIZED", "Unauthorized", 401);
  if (currentUser.role !== "ADMIN" && currentUser.role !== "SUPERADMIN") {
    return fail(c, "FORBIDDEN", "Forbidden", 403);
  }
  c.set("user", currentUser);
  return next();
}

/** Only the super admin — e.g. for managing who can sign in. */
export async function requireSuperAdmin(c: Context, next: Next): Promise<Response | void> {
  const currentUser = await resolveUser(c);
  if (!currentUser) return fail(c, "UNAUTHORIZED", "Unauthorized", 401);
  if (currentUser.role !== "SUPERADMIN") {
    return fail(c, "FORBIDDEN", "Only the super admin can do this.", 403);
  }
  c.set("user", currentUser);
  return next();
}

export async function requireGuestOrAdmin(c: Context, next: Next): Promise<Response | void> {
  const currentUser = await resolveUser(c);
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
