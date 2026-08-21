"use server";

import { db, experience, isNull } from "@platform/db";
import { asc, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";
import { extractCoverImage } from "@/lib/extract-cover-image";

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

/**
 * Runs its own query (rather than the shared `listExperiences`, which also
 * backs the public GET /api/experiences and must stay lightweight) so it can
 * pull templateContent and derive a coverImage for drag/swipe-style pickers.
 */
export async function getExperiences(): Promise<{ id: string; title: string; coverImage: string | null }[]> {
  await requireGuestOrAdmin();
  const rows = await db
    .select({ id: experience.id, name: experience.name, templateContent: experience.templateContent })
    .from(experience)
    .where(isNull(experience.deletedAt))
    .orderBy(asc(experience.position), desc(experience.createdAt));
  return rows.map((r) => ({ id: r.id, title: r.name, coverImage: extractCoverImage(r.templateContent) }));
}

export async function deleteProject(id: string): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const res = await apiFetch(`/api/experiences/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return { success: false, error: res.error.message };
  revalidatePath("/experiences");
  revalidatePath("/projects");
  return { success: true };
}
