import { desc, eq, isNull, sql } from "drizzle-orm"

import type { Database } from "../client"
import { contentPush, mediaAsset, screen, user } from "../schema"

export function overviewRepo(db: Database) {
  return {
    async screenCounts(): Promise<{ total: number; paired: number }> {
      const [row] = await db
        .select({
          total: sql<number>`count(*)::int`,
          paired: sql<number>`count(${screen.deviceTokenHash})::int`,
        })
        .from(screen)
        .where(isNull(screen.deletedAt))
      return row ?? { total: 0, paired: 0 }
    },

    async mediaStats(): Promise<{ count: number; bytes: number; byType: Record<string, number> }> {
      const rows = await db
        .select({
          type: mediaAsset.type,
          count: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(${mediaAsset.sizeBytes}), 0)::bigint`,
        })
        .from(mediaAsset)
        .where(isNull(mediaAsset.deletedAt))
        .groupBy(mediaAsset.type)
      const byType: Record<string, number> = {}
      let count = 0
      let bytes = 0
      for (const r of rows) {
        byType[r.type] = r.count
        count += r.count
        bytes += Number(r.bytes)
      }
      return { count, bytes, byType }
    },

    /** The push audit log, newest first, with names resolved. */
    async recentPushes(limit = 10) {
      return db
        .select({
          id: contentPush.id,
          at: contentPush.pushedAt,
          action: contentPush.action,
          screenId: contentPush.screenId,
          screenName: screen.name,
          mediaName: mediaAsset.name,
          userName: user.name,
        })
        .from(contentPush)
        .innerJoin(screen, eq(screen.id, contentPush.screenId))
        .leftJoin(mediaAsset, eq(mediaAsset.id, contentPush.mediaId))
        .leftJoin(user, eq(user.id, contentPush.pushedByUserId))
        .orderBy(desc(contentPush.pushedAt))
        .limit(limit)
    },
  }
}
