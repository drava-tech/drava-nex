"use server";

import { db, experience, eq, and, isNull } from "@platform/db";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function createProject(
  name: string,
  slug: string
): Promise<{ success: boolean; error?: string }> {
  const currentUser = await requireAdmin();

  const trimmedName = name.trim();
  const trimmedSlug = slug.trim();

  if (!trimmedName) {
    return { success: false, error: "Project name is required." };
  }
  if (!trimmedSlug) {
    return { success: false, error: "Slug is required." };
  }
  if (!SLUG_REGEX.test(trimmedSlug)) {
    return {
      success: false,
      error:
        "Slug must use only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen.",
    };
  }

  const [existing] = await db
    .select({ id: experience.id })
    .from(experience)
    .where(and(eq(experience.slug, trimmedSlug), isNull(experience.deletedAt)))
    .limit(1);

  if (existing) {
    return {
      success: false,
      error: `A project with slug "${trimmedSlug}" already exists.`,
    };
  }

  await db.insert(experience).values({
    name: trimmedName,
    slug: trimmedSlug,
    createdByUserId: currentUser.id,
    updatedByUserId: currentUser.id,
  });

  revalidatePath("/projects");
  return { success: true };
}

export async function reorderExperiences(
  orderedIds: string[]
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(experience)
        .set({ position: i })
        .where(eq(experience.id, orderedIds[i]!));
    }
  });

  revalidatePath("/experiences");
  return { success: true };
}
