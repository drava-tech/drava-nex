import { sql } from "drizzle-orm";
import { db } from "../client.js";

export interface DashboardActivityItem {
  id: string;
  kind: "screen" | "experience" | "media";
  /** Verb, already phrased for display. */
  action: string;
  /** What it happened to. */
  target: string;
  at: Date;
}

/**
 * The most recent things that actually happened, newest first.
 *
 * Drawn from the two append-only logs that exist — screen_content_push (every
 * push to a screen, indexed on pushed_at) and media_asset.created_at (every
 * upload or saved link). Both carry real timestamps, so the "5m ago" this feed
 * shows ages properly, unlike the frozen strings it replaces.
 *
 * NO ACTOR. screen_content_push has no user column and media_asset's
 * uploaded_by_user_id is nullable and unset for email/link ingests, so this
 * reports what happened rather than attributing it to a person. Naming the
 * wrong colleague is worse than naming nobody; adding pushed_by_user_id is its
 * own change.
 */
export async function getRecentActivity(limit = 8): Promise<DashboardActivityItem[]> {
  const { rows } = await db.execute<{
    id: string;
    kind: string;
    action: string;
    target: string;
    // A string, not a Date: db.execute() bypasses drizzle column mapping.
    // Converted below.
    at: string;
  }>(sql`
    (
      SELECT
        'push-' || p.id                                   AS id,
        CASE WHEN p.content_kind = 'experience' THEN 'experience' ELSE 'screen' END AS kind,
        'pushed'                                          AS action,
        coalesce(m.name, e.name, 'content') || ' → ' || coalesce(s.screen_name, p.screen_id) AS target,
        p.pushed_at                                       AS at
      FROM screen_content_push p
      LEFT JOIN media_asset m ON m.id = p.media_asset_id
      LEFT JOIN experience  e ON e.id = p.experience_id
      LEFT JOIN screen      s ON s.screen_id = p.screen_id
      ORDER BY p.pushed_at DESC
      LIMIT ${limit}
    )
    UNION ALL
    (
      SELECT
        'media-' || m.id                                  AS id,
        'media'                                           AS kind,
        CASE WHEN m.source = 'upload' THEN 'uploaded'
             WHEN m.source = 'email'  THEN 'received'
             ELSE 'added' END                             AS action,
        m.name                                            AS target,
        m.created_at                                      AS at
      FROM media_asset m
      WHERE m.deleted_at IS NULL
      ORDER BY m.created_at DESC
      LIMIT ${limit}
    )
    ORDER BY at DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    id: r.id,
    kind: (r.kind === "experience" ? "experience" : r.kind === "media" ? "media" : "screen") as
      | "screen"
      | "experience"
      | "media",
    action: r.action,
    target: r.target,
    at: new Date(r.at),
  }));
}
