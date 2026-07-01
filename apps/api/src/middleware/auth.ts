import type { Context, Next } from "hono";
import { auth } from "../lib/auth.js";
import { fail } from "../lib/response.js";
import { verifyApiKey, scopeSatisfies, type VerifiedApiKey } from "@platform/db";

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

/**
 * Guard for machine clients (Unreal Engine, IoT, automation). Accepts EITHER:
 *  - an admin/superadmin cookie/bearer session (CMS, humans), OR
 *  - a valid `x-api-key` whose scopes satisfy every entry in `requiredScopes`.
 *
 * On success sets `apiClient` (for key callers) and/or `user` (for sessions).
 */
export function requireApiClient(
  requiredScopes: string[] = [],
  opts: { allowGuest?: boolean } = {}
) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    // 1) An admin/superadmin session may always pass (guests too if allowed).
    const currentUser = await resolveUser(c);
    if (currentUser) {
      const role = currentUser.role;
      if (role === "ADMIN" || role === "SUPERADMIN" || (opts.allowGuest && role === "GUEST")) {
        c.set("user", currentUser);
        return next();
      }
    }

    // 2) Otherwise require an API key with the needed scopes.
    const rawKey = c.req.header("x-api-key");
    if (!rawKey) return fail(c, "UNAUTHORIZED", "Unauthorized", 401);

    const key: VerifiedApiKey | null = await verifyApiKey(rawKey);
    if (!key) return fail(c, "UNAUTHORIZED", "Invalid or expired API key", 401);

    const ok = requiredScopes.every((s) => scopeSatisfies(key.scopes, s));
    if (!ok) return fail(c, "FORBIDDEN", "Insufficient scope", 403);

    c.set("apiClient", key);
    return next();
  };
}
