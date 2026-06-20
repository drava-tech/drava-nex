import { isNull, asc, desc } from "drizzle-orm";
import { db } from "../client.js";
import { experience } from "../schema/projects.js";

/** All non-deleted experiences, ordered for display (used by CMS + screens picker). */
export async function listExperiences(): Promise<{ id: string; title: string }[]> {
  const rows = await db
    .select({ id: experience.id, name: experience.name })
    .from(experience)
    .where(isNull(experience.deletedAt))
    .orderBy(asc(experience.position), desc(experience.createdAt));
  return rows.map((r) => ({ id: r.id, title: r.name }));
}
