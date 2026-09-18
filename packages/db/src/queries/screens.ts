import { and, asc, eq, inArray, isNull } from "drizzle-orm"

import type { Database } from "../client"
import { contentPush, mediaAsset, screen, type ContentPushRow, type ScreenRow } from "../schema"

const live = isNull(screen.deletedAt)

export function screensRepo(db: Database) {
  return {
    list(): Promise<ScreenRow[]> {
      return db.select().from(screen).where(live).orderBy(asc(screen.createdAt))
    },

    async get(id: string): Promise<ScreenRow | null> {
      const [row] = await db
        .select()
        .from(screen)
        .where(and(eq(screen.id, id), live))
        .limit(1)
      return row ?? null
    },

    async create(values: { id: string; name: string }): Promise<ScreenRow> {
      const [row] = await db.insert(screen).values(values).returning()
      return row!
    },

    async rename(id: string, name: string): Promise<ScreenRow | null> {
      const [row] = await db
        .update(screen)
        .set({ name })
        .where(and(eq(screen.id, id), live))
        .returning()
      return row ?? null
    },

    /**
     * Soft delete. Also drops the device token, so a deleted screen that is
     * still running can never register again.
     */
    async softDelete(id: string): Promise<boolean> {
      const rows = await db
        .update(screen)
        .set({ deletedAt: new Date(), deviceTokenHash: null })
        .where(and(eq(screen.id, id), live))
        .returning({ id: screen.id })
      return rows.length > 0
    },

    // ─── Push controls ──────────────────────────────────────────────────────

    /** Plays one item (or clears to the default with null). Ends any queue. */
    async setCurrentMedia(id: string, mediaId: string | null): Promise<ScreenRow | null> {
      const [row] = await db
        .update(screen)
        .set({ currentMediaId: mediaId, queueMediaIds: [], queueIndex: 0, blanked: false })
        .where(and(eq(screen.id, id), live))
        .returning()
      return row ?? null
    },

    /** Starts an ordered queue at startIndex (clamped). */
    async setQueue(id: string, mediaIds: string[], startIndex: number): Promise<ScreenRow | null> {
      const index = Math.min(Math.max(0, startIndex), mediaIds.length - 1)
      const [row] = await db
        .update(screen)
        .set({ queueMediaIds: mediaIds, queueIndex: index, currentMediaId: mediaIds[index] ?? null, blanked: false })
        .where(and(eq(screen.id, id), live))
        .returning()
      return row ?? null
    },

    /**
     * Steps the queue one item, clamped at both ends (a presenter pressing
     * "next" on the last slide should stay there, not jump to the first).
     * Returns null when the screen has no queue.
     */
    async stepQueue(id: string, direction: "next" | "prev"): Promise<ScreenRow | null> {
      return db.transaction(async (tx) => {
        const [current] = await tx.select().from(screen).where(and(eq(screen.id, id), live)).for("update")
        if (!current || current.queueMediaIds.length === 0) return null
        const last = current.queueMediaIds.length - 1
        const index = Math.min(last, Math.max(0, current.queueIndex + (direction === "next" ? 1 : -1)))
        const [row] = await tx
          .update(screen)
          .set({ queueIndex: index, currentMediaId: current.queueMediaIds[index] ?? null })
          .where(eq(screen.id, id))
          .returning()
        return row ?? null
      })
    },

    async setDefaultMedia(id: string, mediaId: string | null): Promise<ScreenRow | null> {
      const [row] = await db
        .update(screen)
        .set({ defaultMediaId: mediaId })
        .where(and(eq(screen.id, id), live))
        .returning()
      return row ?? null
    },

    async setBlanked(id: string, blanked: boolean): Promise<ScreenRow | null> {
      const [row] = await db.update(screen).set({ blanked }).where(and(eq(screen.id, id), live)).returning()
      return row ?? null
    },

    /** Which of these ids are live media items (for validating a push). */
    async existingMediaIds(ids: string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set()
      const rows = await db
        .select({ id: mediaAsset.id })
        .from(mediaAsset)
        .where(and(inArray(mediaAsset.id, ids), isNull(mediaAsset.deletedAt)))
      return new Set(rows.map((r) => r.id))
    },

    /** Audit log: what went to which screen, and who sent it. */
    async logPush(entry: {
      screenId: string
      mediaId: string | null
      action: ContentPushRow["action"]
      userId: string
    }): Promise<void> {
      await db.insert(contentPush).values({
        screenId: entry.screenId,
        mediaId: entry.mediaId,
        action: entry.action,
        pushedByUserId: entry.userId,
      })
    },
  }
}

export type ScreensRepo = ReturnType<typeof screensRepo>
