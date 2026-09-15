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

export interface UserStats {
  /** Distinct users holding at least one unexpired session right now. */
  activeNow: number;
  total: number;
  /** Role → count among all users. */
  byRole: { role: string; count: number }[];
}

/**
 * Who is actually signed in, from the session table.
 *
 * "Active" means holding an unexpired session, counted DISTINCT on user_id —
 * one person with a laptop and a tablet is one active user, not two. The card
 * this replaces simply asserted "4".
 */
export async function getUserStats(): Promise<UserStats> {
  const [active, roles] = await Promise.all([
    db.execute<{ count: string }>(sql`
      SELECT count(DISTINCT user_id) AS count FROM session WHERE expires_at > now()
    `),
    db.execute<{ role: string; count: string }>(sql`
      SELECT role, count(*) AS count FROM "user" GROUP BY role ORDER BY count(*) DESC
    `),
  ]);
  const byRole = roles.rows.map((r) => ({ role: r.role, count: Number(r.count) }));
  return {
    activeNow: Number(active.rows[0]?.count ?? 0),
    total: byRole.reduce((sum, r) => sum + r.count, 0),
    byRole,
  };
}
