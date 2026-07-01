"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

/**
 * Assign (or clear) the code-defined template for an experience.
 * Pass `templateKey: null` to unassign.
 */
export async function assignExperienceTemplate(
  experienceId: string,
  templateKey: string | null
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const res = await apiFetch(`/api/experiences/${encodeURIComponent(experienceId)}/template`, {
    method: "PATCH",
    body: JSON.stringify({ templateKey }),
  });
  if (!res.ok) return { success: false, error: res.error.message };
  revalidatePath("/experiences");
  revalidatePath("/projects");
  return { success: true };
}

/**
 * Save a template's content for an experience. The API stores it keyed by
 * templateKey and merged with the existing map, so switching templates never
 * erases another template's content.
 */
export async function updateExperienceTemplateContent(
  experienceId: string,
  templateKey: string,
  content: unknown
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const res = await apiFetch(`/api/experiences/${encodeURIComponent(experienceId)}/content`, {
    method: "PATCH",
    body: JSON.stringify({ templateKey, content }),
  });
  if (!res.ok) return { success: false, error: res.error.message };
  revalidatePath("/experiences");
  return { success: true };
}
