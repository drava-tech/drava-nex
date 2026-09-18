import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm"

import type { Database } from "../client"
import { mediaAsset, screen, type MediaAssetRow, type NewMediaAssetRow } from "../schema"

const live = isNull(mediaAsset.deletedAt)

type Cursor = { c: string; id: string }

function encodeCursor(row: MediaAssetRow): string {
  return Buffer.from(JSON.stringify({ c: row.createdAt.toISOString(), id: row.id })).toString("base64url")
}

function decodeCursor(cursor: string): Cursor | null {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Cursor
    return typeof v.c === "string" && typeof v.id === "string" && !Number.isNaN(Date.parse(v.c)) ? v : null
  } catch {
    return null
  }
}

/** Escape LIKE wildcards so a search for "50%" means the text "50%". */
function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
}

export function mediaRepo(db: Database) {
  return {
    /**
     * Keyset page, newest first. The (created_at, id) row comparison matches
     * media_asset_listing_idx exactly, so every page is an ordered index scan
     * and rows sharing a created_at are never skipped at a page boundary.
     */
    async listPage(q: {
      cursor?: string | undefined
      limit: number
      type?: MediaAssetRow["type"] | undefined
      search?: string | undefined
    }): Promise<{ items: MediaAssetRow[]; nextCursor: string | null }> {
      const where: SQL[] = [live]
      if (q.type) where.push(eq(mediaAsset.type, q.type))
      if (q.search?.trim()) where.push(ilike(mediaAsset.name, likeTerm(q.search.trim())))
      const cursor = q.cursor ? decodeCursor(q.cursor) : null
      if (cursor) {
        where.push(sql`(${mediaAsset.createdAt}, ${mediaAsset.id}) < (${cursor.c}::timestamptz, ${cursor.id})`)
      }
      const rows = await db
        .select()
        .from(mediaAsset)
        .where(and(...where))
        .orderBy(desc(mediaAsset.createdAt), desc(mediaAsset.id))
        .limit(q.limit + 1)
      const items = rows.slice(0, q.limit)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null }
    },

    async get(id: string): Promise<MediaAssetRow | null> {
      const [row] = await db
        .select()
        .from(mediaAsset)
        .where(and(eq(mediaAsset.id, id), live))
        .limit(1)
      return row ?? null
    },

    /** Insert, or return the existing row if this id was already committed. */
    async insert(values: NewMediaAssetRow & { id: string }): Promise<MediaAssetRow> {
      const [row] = await db.insert(mediaAsset).values(values).onConflictDoNothing().returning()
      if (row) return row
      const [existing] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, values.id)).limit(1)
      return existing!
    },

    /**
     * Soft-deletes an asset and detaches it from every screen in the same
     * transaction: current item, default item and queues. Returns the row and
     * the screens whose content changed, so the caller can re-push them.
     */
    async softDelete(id: string): Promise<{ row: MediaAssetRow; affectedScreenIds: string[] } | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(mediaAsset)
          .set({ deletedAt: new Date() })
          .where(and(eq(mediaAsset.id, id), live))
          .returning()
        if (!row) return null

        const affected = await tx
          .update(screen)
          .set({
            currentMediaId: sql`CASE WHEN ${screen.currentMediaId} = ${id} THEN NULL ELSE ${screen.currentMediaId} END`,
            defaultMediaId: sql`CASE WHEN ${screen.defaultMediaId} = ${id} THEN NULL ELSE ${screen.defaultMediaId} END`,
            queueMediaIds: sql`COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(${screen.queueMediaIds}) e WHERE e <> to_jsonb(${id}::text)), '[]'::jsonb)`,
          })
          .where(
            or(
              eq(screen.currentMediaId, id),
              eq(screen.defaultMediaId, id),
              sql`${screen.queueMediaIds} @> to_jsonb(ARRAY[${id}::text])`
            )
          )
          .returning({ id: screen.id })

        return { row, affectedScreenIds: affected.map((s) => s.id) }
      })
    },

    /** Every object key still referenced by a row (deleted or not), for the orphan reaper. */
    async referencedKeys(): Promise<Set<string>> {
      const rows = await db
        .select({ key: mediaAsset.objectKey, thumb: mediaAsset.thumbObjectKey, deletedAt: mediaAsset.deletedAt })
        .from(mediaAsset)
      const keys = new Set<string>()
      for (const r of rows) {
        // A soft-deleted row's objects are already gone or going; don't protect them.
        if (r.deletedAt) continue
        if (r.key) keys.add(r.key)
        if (r.thumb) keys.add(r.thumb)
      }
      return keys
    },
  }
}

export type MediaRepo = ReturnType<typeof mediaRepo>
