"use server";

import { db, experience, eq } from "@platform/db";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { isTemplateKey } from "@/lib/templates";

/**
 * Assign (or clear) the code-defined template for an experience.
 * Pass `templateKey: null` to unassign.
 */
export async function assignExperienceTemplate(
  experienceId: string,
  templateKey: string | null
): Promise<{ success: boolean; error?: string }> {
  const currentUser = await requireAdmin();

  if (templateKey !== null && !isTemplateKey(templateKey)) {
    return { success: false, error: `Unknown template: "${templateKey}".` };
  }

  try {
    await db
      .update(experience)
      .set({
        templateKey,
        updatedByUserId: currentUser.id,
        updatedAt: new Date(),
      })
      .where(eq(experience.id, experienceId));

    revalidatePath("/experiences");
    revalidatePath("/projects");
    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error: (error as Error).message || "Failed to assign template.",
    };
  }
}

/**
 * Save a template's content for an experience. Stored keyed by templateKey
 * (`templateContent[templateKey] = content`) and merged with the existing map, so
 * switching templates never erases another template's content.
 */
export async function updateExperienceTemplateContent(
  experienceId: string,
  templateKey: string,
  content: unknown
): Promise<{ success: boolean; error?: string }> {
  const currentUser = await requireAdmin();

  if (!isTemplateKey(templateKey)) {
    return { success: false, error: `Unknown template: "${templateKey}".` };
  }

  try {
    const [row] = await db
      .select({ templateContent: experience.templateContent })
      .from(experience)
      .where(eq(experience.id, experienceId))
      .limit(1);

    const existing = (row?.templateContent ?? {}) as Record<string, unknown>;
    const merged = { ...existing, [templateKey]: content };

    await db
      .update(experience)
      .set({ templateContent: merged, updatedByUserId: currentUser.id, updatedAt: new Date() })
      .where(eq(experience.id, experienceId));

    revalidatePath("/experiences");
    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error: (error as Error).message || "Failed to save content.",
    };
  }
}
