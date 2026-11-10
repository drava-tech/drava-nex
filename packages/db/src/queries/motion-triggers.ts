import { asc, eq, and, isNull } from "drizzle-orm";
import { db } from "../client.js";
import { motionTrigger } from "../schema/motion-triggers.js";
import { mediaAsset } from "../schema/media.js";

export interface MotionTriggerRow {
  id: string;
  name: string;
  sensorId: string;
  screenIds: string[];
  groupIds: string[];
  /** The content to play; null when it was deleted from the library. */
  media: { id: string; name: string; type: string; url: string; thumbnailUrl: string | null } | null;
  durationSeconds: number;
  cooldownSeconds: number;
  startTime: string | null;
  endTime: string | null;
  daysOfWeek: number[];
  timezone: string;
  createdAt: string;
}

export interface MotionTriggerInput {
  name: string;
  sensorId: string;
  screenIds: string[];
  groupIds: string[];
  mediaAssetId: string;
  durationSeconds: number;
  cooldownSeconds: number;
  startTime: string | null;
  endTime: string | null;
  daysOfWeek: number[];
  timezone: string;
}

export async function listMotionTriggers(): Promise<MotionTriggerRow[]> {
  const rows = await db
    .select({
      t: motionTrigger,
      mediaId: mediaAsset.id,
      mediaName: mediaAsset.name,
      mediaType: mediaAsset.type,
      mediaUrl: mediaAsset.url,
      mediaThumb: mediaAsset.thumbnailUrl,
    })
    .from(motionTrigger)
    .leftJoin(mediaAsset, and(eq(motionTrigger.mediaAssetId, mediaAsset.id), isNull(mediaAsset.deletedAt)))
    .orderBy(asc(motionTrigger.createdAt));
  return rows.map(({ t, ...m }) => ({
    id: t.id,
    name: t.name,
    sensorId: t.sensorId,
    screenIds: t.screenIds,
    groupIds: t.groupIds,
    media: m.mediaId
      ? { id: m.mediaId, name: m.mediaName ?? "", type: m.mediaType ?? "", url: m.mediaUrl ?? "", thumbnailUrl: m.mediaThumb }
      : null,
    durationSeconds: t.durationSeconds,
    cooldownSeconds: t.cooldownSeconds,
    startTime: t.startTime,
    endTime: t.endTime,
    daysOfWeek: t.daysOfWeek,
    timezone: t.timezone,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function motionTriggerExists(id: string): Promise<boolean> {
  const [row] = await db.select({ id: motionTrigger.id }).from(motionTrigger).where(eq(motionTrigger.id, id)).limit(1);
  return Boolean(row);
}

export async function createMotionTrigger(input: MotionTriggerInput): Promise<{ id: string }> {
  const [row] = await db.insert(motionTrigger).values(input).returning({ id: motionTrigger.id });
  if (!row) throw new Error("Failed to create motion trigger");
  return row;
}

export async function updateMotionTrigger(id: string, input: MotionTriggerInput): Promise<void> {
  await db.update(motionTrigger).set({ ...input, updatedAt: new Date() }).where(eq(motionTrigger.id, id));
}

export async function deleteMotionTrigger(id: string): Promise<void> {
  await db.delete(motionTrigger).where(eq(motionTrigger.id, id));
}
