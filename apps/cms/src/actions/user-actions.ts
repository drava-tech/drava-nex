"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

export async function createUser(
  name: string,
  email: string,
  password: string,
  role: "ADMIN" | "GUEST"
) {
  await requireAdmin();
  const res = await apiFetch<{ id: string }>(`/api/users`, {
    method: "POST",
    body: JSON.stringify({ name, email, password, role }),
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/users");
  return res.data.id;
}

export async function deleteUser(targetUserId: string) {
  await requireAdmin();
  const res = await apiFetch(`/api/users/${encodeURIComponent(targetUserId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/users");
}
