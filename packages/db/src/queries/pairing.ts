import { and, eq, gt, isNull } from "drizzle-orm"

import type { Database } from "../client"
import { pairingCode, screen, type ScreenRow } from "../schema"

export function pairingRepo(db: Database) {
  return {
    /**
     * Issues a new code for a screen, replacing any unclaimed one — only the
     * latest code shown in the console can work.
     */
    async issue(screenId: string, code: string, expiresAt: Date): Promise<void> {
      await db.transaction(async (tx) => {
        await tx
          .delete(pairingCode)
          .where(and(eq(pairingCode.screenId, screenId), isNull(pairingCode.claimedAt)))
        await tx.insert(pairingCode).values({ code, screenId, expiresAt })
      })
    },

    /**
     * Redeems a code: marks it used and binds the new device token hash to its
     * screen, atomically. Returns null for unknown, expired or used codes.
     * Binding a new hash revokes whatever device held the screen before.
     */
    async claim(code: string, tokenHash: string): Promise<ScreenRow | null> {
      return db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(pairingCode)
          .set({ claimedAt: new Date() })
          .where(
            and(
              eq(pairingCode.code, code),
              isNull(pairingCode.claimedAt),
              gt(pairingCode.expiresAt, new Date())
            )
          )
          .returning({ screenId: pairingCode.screenId })
        if (!claimed) return null

        const [row] = await tx
          .update(screen)
          .set({ deviceTokenHash: tokenHash, pairedAt: new Date() })
          .where(and(eq(screen.id, claimed.screenId), isNull(screen.deletedAt)))
          .returning()
        return row ?? null
      })
    },

    async findScreenByTokenHash(tokenHash: string): Promise<ScreenRow | null> {
      const [row] = await db
        .select()
        .from(screen)
        .where(and(eq(screen.deviceTokenHash, tokenHash), isNull(screen.deletedAt)))
        .limit(1)
      return row ?? null
    },

    /** Forgets the paired device (and any pending code). */
    async unpair(screenId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        await tx.delete(pairingCode).where(eq(pairingCode.screenId, screenId))
        const rows = await tx
          .update(screen)
          .set({ deviceTokenHash: null, pairedAt: null })
          .where(and(eq(screen.id, screenId), isNull(screen.deletedAt)))
          .returning({ id: screen.id })
        return rows.length > 0
      })
    },

    async markSeen(screenId: string): Promise<void> {
      await db.update(screen).set({ lastSeenAt: new Date() }).where(eq(screen.id, screenId))
    },
  }
}

export type PairingRepo = ReturnType<typeof pairingRepo>
