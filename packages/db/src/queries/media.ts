import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "../client.js";
import { mediaAsset, type MediaAsset } from "../schema/media.js";

/** All non-deleted media assets, newest first (backs the media library + pickers). */
export async function listMediaAssets(filter?: { source?: string }): Promise<MediaAsset[]> {
  return db
    .select()
    .from(mediaAsset)
    .where(
      filter?.source
        ? and(isNull(mediaAsset.deletedAt), eq(mediaAsset.source, filter.source))
        : isNull(mediaAsset.deletedAt)
    )
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
