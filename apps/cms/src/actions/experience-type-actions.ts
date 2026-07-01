"use server";

import { listExperienceTypes } from "@platform/db";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

export async function getExperienceTypes(): Promise<{ id: string; name: string }[]> {
  await requireGuestOrAdmin();
  return listExperienceTypes();
}

export async function createExperienceType(
  name: string
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const res = await apiFetch(`/api/experience-types`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return { success: false, error: res.error.message };
  revalidatePath("/settings");
  return { success: true };
}

export async function deleteExperienceType(
  id: string
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const res = await apiFetch(`/api/experience-types/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return { success: false, error: res.error.message };
  revalidatePath("/settings");
  return { success: true };
}
