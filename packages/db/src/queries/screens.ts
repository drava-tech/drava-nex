import { and, asc, eq, isNull } from "drizzle-orm"

import type { Database } from "../client"
import { screen, type ScreenRow } from "../schema"

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
  }
}

export type ScreensRepo = ReturnType<typeof screensRepo>
