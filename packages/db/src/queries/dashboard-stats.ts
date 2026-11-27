import { sql } from "drizzle-orm";
import { db } from "../client.js";

export interface ExperienceBreakdown {
  total: number;
  /** Template key → count, largest first. */
  byTemplate: { templateKey: string; count: number }[];
}

/** Live experience count, grouped by the template each one uses. */
export async function getExperienceStats(): Promise<ExperienceBreakdown> {
  const { rows } = await db.execute<{ template_key: string | null; count: string }>(sql`
    SELECT template_key, count(*) AS count
    FROM experience
    WHERE deleted_at IS NULL
    GROUP BY template_key
    ORDER BY count(*) DESC
  `);
  const byTemplate = rows.map((r) => ({
    templateKey: r.template_key ?? "unassigned",
    count: Number(r.count),
  }));
  return { total: byTemplate.reduce((sum, t) => sum + t.count, 0), byTemplate };
}
