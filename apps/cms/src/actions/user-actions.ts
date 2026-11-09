"use server";

import { revalidatePath } from "next/cache";
import { listUsers, type UserListRow } from "@platform/db";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

// Managing who can sign in — the super admin only, here and in the API.
// Reads are direct (DB); changes go through the API, which owns Better Auth.

type Result = { success: true } | { success: false; error: string };
type Role = "ADMIN" | "GUEST";

function done(res: { ok: boolean; error?: { message: string } }): Result {
  if (!res.ok) return { success: false, error: res.error?.message ?? "Something went wrong." };
  revalidatePath("/settings");
  return { success: true };
}

export async function getUsers(): Promise<UserListRow[]> {
  await requireSuperAdmin();
  return listUsers();
}

export async function createUser(input: { name: string; email: string; password: string; role: Role }): Promise<Result> {
  await requireSuperAdmin();
  return done(await apiFetch(`/api/users`, { method: "POST", body: JSON.stringify(input) }));
}

export async function changeUserRole(id: string, role: Role): Promise<Result> {
  await requireSuperAdmin();
  return done(await apiFetch(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ role }) }));
}

export async function resetUserPassword(id: string, password: string): Promise<Result> {
  await requireSuperAdmin();
  return done(
    await apiFetch(`/api/users/${encodeURIComponent(id)}/password`, { method: "POST", body: JSON.stringify({ password }) })
  );
}

export async function deleteUser(id: string): Promise<Result> {
  await requireSuperAdmin();
  return done(await apiFetch(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
