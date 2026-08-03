import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "../client.js";
import { mediaAsset, type MediaAsset } from "../schema/media.js";

/**
 * All non-deleted media assets, newest first (backs the media library +
 * pickers). Excludes pending-save rows (an ad-hoc Browser-tool push not yet
 * confirmed as worth keeping) — they're fully playable/assignable, just not
 * listed until saved.
 */
export async function listMediaAssets(filter?: { source?: string }): Promise<MediaAsset[]> {
  const conditions = [isNull(mediaAsset.deletedAt), eq(mediaAsset.pendingSave, false)];
  if (filter?.source) conditions.push(eq(mediaAsset.source, filter.source));
  return db
    .select()
    .from(mediaAsset)
    .where(and(...conditions))
    .orderBy(desc(mediaAsset.createdAt));
}

/**
 * All non-deleted media assets from one source (e.g. "gmail"), newest first —
 * backs the Email Media page, which is just a source-filtered view of the
 * same permanent rows listMediaAssets() surfaces everywhere else (Gmail
 * ingestion stores directly as pendingSave: false, so there's no separate
 * pending/review state to filter on here).
 */
export async function listMediaAssetsBySource(source: string): Promise<MediaAsset[]> {
  return db
    .select()
    .from(mediaAsset)
    .where(and(isNull(mediaAsset.deletedAt), eq(mediaAsset.source, source)))
    .orderBy(desc(mediaAsset.createdAt));
}

export async function getMediaAsset(id: string): Promise<MediaAsset | null> {
  const [row] = await db
    .select()
    .from(mediaAsset)
    .where(and(eq(mediaAsset.id, id), isNull(mediaAsset.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function createMediaAsset(values: {
  type: string;
  url: string;
  name: string;
  sizeBytes?: number | null;
  uploadedByUserId?: string | null;
  source?: string | null;
  emailFrom?: string | null;
  emailSubject?: string | null;
  pendingSave?: boolean;
}): Promise<MediaAsset> {
  const [row] = await db.insert(mediaAsset).values(values).returning();
  if (!row) throw new Error("Failed to create media asset");
  return row;
}

export async function softDeleteMediaAsset(id: string): Promise<void> {
  await db
    .update(mediaAsset)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(mediaAsset.id, id));
}

/** Confirms an ad-hoc pushed link is worth keeping — makes it show up in the Media Library from now on. */
export async function markMediaSaved(id: string): Promise<void> {
  await db
    .update(mediaAsset)
    .set({ pendingSave: false, updatedAt: new Date() })
    .where(eq(mediaAsset.id, id));
}
