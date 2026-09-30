import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

/**
 * Memoized for the lifetime of one server request.
 *
 * Every guard in this file funnels through here, and the guards are called
 * independently by the dashboard layout, the page, and each server action the
 * page awaits — a single /screens render resolved the session SEVEN times.
 * Better Auth's cookie cache blunts the cost (most are an HMAC verification
 * rather than a session ⋈ user lookup), but every 5 minutes the first render
 * paid seven sequential round trips before any page data was fetched.
 *
 * React's `cache` is per-request, so this cannot leak one user's session into
 * another's request.
 */
export const getCurrentUser = cache(async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session?.user ?? null;
});

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireAuth();
  const role = (user as { role?: string }).role;
  if (role !== "ADMIN" && role !== "SUPERADMIN") redirect("/403");
  return user as typeof user & { role: "ADMIN" | "SUPERADMIN" };
}

export async function requireGuestOrAdmin() {
  const user = await requireAuth();
  const role = (user as { role?: string }).role;
  if (role !== "ADMIN" && role !== "GUEST" && role !== "SUPERADMIN") redirect("/403");
  return user as typeof user & { role: "ADMIN" | "GUEST" | "SUPERADMIN" };
}
