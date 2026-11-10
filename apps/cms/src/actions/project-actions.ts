"use server";

import { db, experience, experienceToType, mediaAsset, isNull } from "@platform/db";
import { asc, desc } from "drizzle-orm";
import { revalidatePath, unstable_cache } from "next/cache";
import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";
import { experienceCover, extractCoverImage } from "@/lib/extract-cover-image";

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
 * pull templateContent and derive a coverImage for drag/swipe-style pickers,
 * plus each experience's tag (experience_type) ids for tag-based filtering —
 * same bulk-join pattern as apps/cms/src/app/(dashboard)/experiences/page.tsx.
 */
type ExperienceCard = { id: string; title: string; coverImage: string | null; typeIds: string[] };

/**
 * The expensive half, cached in RAM for 20s.
 *
 * This selects every experience's full `templateContent` JSONB and runs
 * extractCoverImage (a BFS up to 2000 nodes) over each one, purely to derive a
 * thumbnail URL — then discards the JSON. It is called on /screens,
 * /screens/[id] and /broadcast, and `revalidatePath` makes it re-run on every
 * publish too, so a swipe-to-publish was dragging the whole experience corpus
 * across the DB socket before the operator saw anything happen.
 *
 * Cached rather than denormalised into a `cover_image` column because that
 * would need a migration, a backfill, and a write-path hook on every template
 * save to stay correct. A short TTL buys most of the win with none of that; the
 * column is the right move only if this shows up hot again.
 *
 * Module-private on purpose: this file is "use server", where every EXPORT must
 * be an async function, and unstable_cache returns a plain function.
 */
const getExperienceCards = unstable_cache(
  async (): Promise<ExperienceCard[]> => {
    const [rows, assignments, mediaRows] = await Promise.all([
      db
        .select({ id: experience.id, name: experience.name, templateKey: experience.templateKey, templateContent: experience.templateContent })
        .from(experience)
        .where(isNull(experience.deletedAt))
        .orderBy(asc(experience.position), desc(experience.createdAt)),
      db.select({ experienceId: experienceToType.experienceId, typeId: experienceToType.typeId }).from(experienceToType),
      // ponytail: Map raw media URLs in experience templates to their derived thumbnail_url for lightweight cards.
      db
        .select({ url: mediaAsset.url, thumbnailUrl: mediaAsset.thumbnailUrl })
        .from(mediaAsset)
        .where(isNull(mediaAsset.deletedAt)),
    ]);

    const typeIdsByExperience = new Map<string, string[]>();
    for (const { experienceId, typeId } of assignments) {
      const list = typeIdsByExperience.get(experienceId);
      if (list) list.push(typeId);
      else typeIdsByExperience.set(experienceId, [typeId]);
    }

    const thumbMap = new Map<string, string>();
    for (const m of mediaRows) {
      if (m.thumbnailUrl && m.url) {
        thumbMap.set(m.url, m.thumbnailUrl);
      }
    }

    return rows.map((r) => {
      const rawCover = extractCoverImage(r.templateContent);
      const coverImage = rawCover ? (thumbMap.get(rawCover) ?? rawCover) : experienceCover(null, r.templateKey);
      return {
        id: r.id,
        title: r.name,
        coverImage,
        typeIds: typeIdsByExperience.get(r.id) ?? [],
      };
    });
  },
  ["experiences:cards"],
  { revalidate: 20, tags: ["experiences"] }
);

export async function getExperiences(): Promise<ExperienceCard[]> {
  // Auth stays OUTSIDE the cache — unstable_cache cannot read headers(), and
  // caching an authorization decision would be a security bug regardless.
  await requireGuestOrAdmin();
  return getExperienceCards();
}

export async function deleteProject(id: string): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const res = await apiFetch(`/api/experiences/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return { success: false, error: res.error.message };
  revalidatePath("/experiences");
  revalidatePath("/projects");
  return { success: true };
}
