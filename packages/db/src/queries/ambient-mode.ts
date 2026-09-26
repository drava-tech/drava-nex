import { asc, eq } from "drizzle-orm";
import { db } from "../client.js";
import { ambientMode, type AmbientMode } from "../schema/ambient-mode.js";

export async function listAmbientModes(): Promise<AmbientMode[]> {
  return db.select().from(ambientMode).orderBy(asc(ambientMode.position), asc(ambientMode.key));
}

export async function getAmbientMode(key: string): Promise<AmbientMode | null> {
  const [row] = await db.select().from(ambientMode).where(eq(ambientMode.key, key)).limit(1);
  return row ?? null;
}

export async function updateAmbientMode(
  key: string,
  patch: { color?: string; brightness?: number; stripOn?: boolean }
): Promise<AmbientMode | null> {
  const [row] = await db
    .update(ambientMode)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(ambientMode.key, key))
    .returning();
  return row ?? null;
}
