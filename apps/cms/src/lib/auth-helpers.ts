import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export async function getCurrentUser() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session?.user ?? null;
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireAuth();
  if ((user as { role?: string }).role !== "ADMIN") redirect("/403");
  return user as typeof user & { role: "ADMIN" };
}

export async function requireGuestOrAdmin() {
  const user = await requireAuth();
  const role = (user as { role?: string }).role;
  if (role !== "ADMIN" && role !== "GUEST") redirect("/403");
  return user as typeof user & { role: "ADMIN" | "GUEST" };
}
