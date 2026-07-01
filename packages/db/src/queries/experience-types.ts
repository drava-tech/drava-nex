import { eq, asc } from "drizzle-orm";
import { db } from "../client.js";
import { experienceType } from "../schema/experience-types.js";

/** All experience types, alphabetical (backs Settings + pickers). */
export async function listExperienceTypes(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: experienceType.id, name: experienceType.name })
    .from(experienceType)
    .orderBy(asc(experienceType.name));
}

export async function experienceTypeNameExists(name: string): Promise<boolean> {
  const [row] = await db
    .select({ id: experienceType.id })
    .from(experienceType)
    .where(eq(experienceType.name, name))
    .limit(1);
  return !!row;
}

export async function createExperienceType(input: {
  name: string;
  createdByUserId: string;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(experienceType)
    .values({ name: input.name, createdByUserId: input.createdByUserId })
    .returning({ id: experienceType.id });
  if (!row) throw new Error("Failed to create experience type");
  return row;
}

/** Delete a type; join rows in experience_to_type drop via ON DELETE CASCADE. */
export async function deleteExperienceType(id: string): Promise<void> {
  await db.delete(experienceType).where(eq(experienceType.id, id));
}
