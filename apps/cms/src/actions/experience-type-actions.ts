"use server";

import { db, experienceType, eq } from "@platform/db";
import { asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";

export async function getExperienceTypes(): Promise<{ id: string; name: string }[]> {
  await requireGuestOrAdmin();
  const rows = await db
    .select({ id: experienceType.id, name: experienceType.name })
    .from(experienceType)
    .orderBy(asc(experienceType.name));
  return rows;
}

export async function createExperienceType(
  name: string
): Promise<{ success: boolean; error?: string }> {
  const currentUser = await requireAdmin();

  const trimmed = name.trim();
  if (!trimmed) {
    return { success: false, error: "Type name is required." };
  }

  const [existing] = await db
    .select({ id: experienceType.id })
    .from(experienceType)
    .where(eq(experienceType.name, trimmed))
    .limit(1);

  if (existing) {
    return { success: false, error: `A type named "${trimmed}" already exists.` };
  }

  await db.insert(experienceType).values({
    name: trimmed,
    createdByUserId: currentUser.id,
  });

  revalidatePath("/settings");
  return { success: true };
}

export async function deleteExperienceType(
  id: string
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    // Join rows in experience_to_type are removed via ON DELETE CASCADE.
    await db.delete(experienceType).where(eq(experienceType.id, id));
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message || "Failed to delete type.",
    };
  }
}
