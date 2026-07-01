"use server";

import { listExperiences } from "@platform/db";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

// Mutations delegate to the Hono API (the single source of truth); reads stay direct.

export async function createProject(
  name: string,
  slug: string,
  templateKey?: string | null,
  typeIds: string[] = []
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const res = await apiFetch(`/api/experiences`, {
    method: "POST",
    body: JSON.stringify({ name, slug, templateKey: templateKey ?? null, typeIds }),
  });
  if (!res.ok) return { success: false, error: res.error.message };
  revalidatePath("/experiences");
  return { success: true };
}

export async function reorderExperiences(
  orderedIds: string[]
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const res = await apiFetch(`/api/experiences/reorder`, {
    method: "POST",
    body: JSON.stringify({ orderedIds }),
  });
  if (!res.ok) return { success: false, error: res.error.message };
  revalidatePath("/experiences");
  return { success: true };
}

export async function getExperiences(): Promise<{ id: string; title: string }[]> {
  await requireGuestOrAdmin();
  return listExperiences();
}

export async function deleteProject(id: string): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const res = await apiFetch(`/api/experiences/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return { success: false, error: res.error.message };
  revalidatePath("/experiences");
  revalidatePath("/projects");
  return { success: true };
}
