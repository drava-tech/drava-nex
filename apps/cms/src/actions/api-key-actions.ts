"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export async function getApiKeys(): Promise<ApiKeyRow[]> {
  await requireAdmin();
  const res = await apiFetch<ApiKeyRow[]>("/api/api-keys");
  return res.ok ? res.data : [];
}

/** Create a key. The plaintext is returned ONCE — surface it to the admin immediately. */
export async function createApiKey(
  name: string,
  scopes: string[]
): Promise<{ success: boolean; key?: string; error?: string }> {
  await requireAdmin();
  const res = await apiFetch<ApiKeyRow & { key: string }>("/api/api-keys", {
    method: "POST",
    body: JSON.stringify({ name, scopes }),
  });
  if (!res.ok) return { success: false, error: res.error.message };
  revalidatePath("/settings");
  return { success: true, key: res.data.key };
}

export async function revokeApiKey(id: string): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const res = await apiFetch(`/api/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return { success: false, error: res.error.message };
  revalidatePath("/settings");
  return { success: true };
}
