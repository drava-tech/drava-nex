import { isNull, asc, desc, eq, and, ne } from "drizzle-orm";
import { db } from "../client.js";
import { experience } from "../schema/projects.js";
import { experienceToType } from "../schema/experience-types.js";

/** All non-deleted experiences, ordered for display (used by CMS + screens picker). */
export async function listExperiences(): Promise<{ id: string; title: string }[]> {
  const rows = await db
    .select({ id: experience.id, name: experience.name })
    .from(experience)
    .where(isNull(experience.deletedAt))
    .orderBy(asc(experience.position), desc(experience.createdAt));
  return rows.map((r) => ({ id: r.id, title: r.name }));
}

/** Experiences as "verticals" keyed by slug (backs the public GET /api/projects). */
export async function listProjectVerticals(): Promise<
  { id: string; title: string; position: number }[]
> {
  const rows = await db
    .select({ slug: experience.slug, name: experience.name, position: experience.position })
    .from(experience)
    .where(isNull(experience.deletedAt));
  return rows.map((r) => ({ id: r.slug, title: r.name, position: r.position }));
}

/** True if a non-deleted experience (other than excludeId, if given) already uses this slug. */
export async function experienceSlugExists(slug: string, excludeId?: string): Promise<boolean> {
  const conditions = [eq(experience.slug, slug), isNull(experience.deletedAt)];
  if (excludeId) conditions.push(ne(experience.id, excludeId));
  const [row] = await db
    .select({ id: experience.id })
    .from(experience)
    .where(and(...conditions))
    .limit(1);
  return !!row;
}

/** Look up a non-deleted experience's id by its slug, or null if none exists. */
export async function getExperienceIdBySlug(slug: string): Promise<string | null> {
  const [row] = await db
    .select({ id: experience.id })
    .from(experience)
    .where(and(eq(experience.slug, slug), isNull(experience.deletedAt)))
    .limit(1);
  return row?.id ?? null;
}

/** Create an experience and its type associations in one transaction. */
export async function createExperience(input: {
  name: string;
  slug: string;
  templateKey?: string | null;
  createdByUserId: string;
  typeIds?: string[];
}): Promise<{ id: string }> {
  const uniqueTypeIds = Array.from(new Set((input.typeIds ?? []).filter(Boolean)));
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(experience)
      .values({
        name: input.name,
        slug: input.slug,
        templateKey: input.templateKey ?? null,
        createdByUserId: input.createdByUserId,
        updatedByUserId: input.createdByUserId,
      })
      .returning({ id: experience.id });
    if (!created) throw new Error("Failed to create experience");
    if (uniqueTypeIds.length > 0) {
      await tx
        .insert(experienceToType)
        .values(uniqueTypeIds.map((typeId) => ({ experienceId: created.id, typeId })));
    }
    return created;
  });
}

/** Update an experience's name, slug, template, and type associations in one transaction. */
export async function updateExperience(
  id: string,
  input: {
    name: string;
    slug: string;
    templateKey: string | null;
    typeIds: string[];
    updatedByUserId: string;
  }
): Promise<void> {
  const uniqueTypeIds = Array.from(new Set(input.typeIds.filter(Boolean)));
  await db.transaction(async (tx) => {
    await tx
      .update(experience)
      .set({
        name: input.name,
        slug: input.slug,
        templateKey: input.templateKey,
        updatedByUserId: input.updatedByUserId,
        updatedAt: new Date(),
      })
      .where(eq(experience.id, id));
    await tx.delete(experienceToType).where(eq(experienceToType.experienceId, id));
    if (uniqueTypeIds.length > 0) {
      await tx
        .insert(experienceToType)
        .values(uniqueTypeIds.map((typeId) => ({ experienceId: id, typeId })));
    }
  });
}

/** Persist a new display order (index → position) in one transaction. */
export async function reorderExperiences(orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(experience).set({ position: i }).where(eq(experience.id, orderedIds[i]!));
    }
  });
}

export async function softDeleteExperience(id: string): Promise<void> {
  await db.update(experience).set({ deletedAt: new Date() }).where(eq(experience.id, id));
}

export async function setExperienceTemplate(
  id: string,
  templateKey: string | null,
  updatedByUserId: string
): Promise<void> {
  await db
    .update(experience)
    .set({ templateKey, updatedByUserId, updatedAt: new Date() })
    .where(eq(experience.id, id));
}

/** Merge content under templateContent[templateKey] so switching templates never erases another's content. */
export async function mergeExperienceTemplateContent(
  id: string,
  templateKey: string,
  content: unknown,
  updatedByUserId: string
): Promise<void> {
  const [row] = await db
    .select({ templateContent: experience.templateContent })
    .from(experience)
    .where(eq(experience.id, id))
    .limit(1);
  const existing = (row?.templateContent ?? {}) as Record<string, unknown>;
  const merged = { ...existing, [templateKey]: content };
  await db
    .update(experience)
    .set({ templateContent: merged, updatedByUserId, updatedAt: new Date() })
    .where(eq(experience.id, id));
}
