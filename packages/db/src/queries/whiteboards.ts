import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "../client.js";
import { whiteboardDocument, type WhiteboardDocument } from "../schema/whiteboards.js";

/** All non-deleted whiteboards, most recently updated first (backs the saved-whiteboards list). */
export async function listWhiteboardDocuments(): Promise<WhiteboardDocument[]> {
  return db
    .select()
    .from(whiteboardDocument)
    .where(isNull(whiteboardDocument.deletedAt))
    .orderBy(desc(whiteboardDocument.updatedAt));
}

export async function getWhiteboardDocument(id: string): Promise<WhiteboardDocument | null> {
  const [row] = await db
    .select()
    .from(whiteboardDocument)
    .where(and(eq(whiteboardDocument.id, id), isNull(whiteboardDocument.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function createWhiteboardDocument(values: {
  name: string;
  pages: unknown[];
  createdByUserId?: string | null;
}): Promise<WhiteboardDocument> {
  const [row] = await db
    .insert(whiteboardDocument)
    .values({ ...values, updatedByUserId: values.createdByUserId })
    .returning();
  if (!row) throw new Error("Failed to create whiteboard document");
  return row;
}

export async function updateWhiteboardDocument(
  id: string,
  values: { name?: string; pages?: unknown[]; updatedByUserId?: string | null }
): Promise<WhiteboardDocument | null> {
  const [row] = await db
    .update(whiteboardDocument)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(whiteboardDocument.id, id), isNull(whiteboardDocument.deletedAt)))
    .returning();
  return row ?? null;
}

export async function softDeleteWhiteboardDocument(id: string): Promise<void> {
  await db
    .update(whiteboardDocument)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(whiteboardDocument.id, id));
}
