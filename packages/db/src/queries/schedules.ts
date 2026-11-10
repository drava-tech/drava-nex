import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { ScheduleContentKind, ScheduleSpec } from "@platform/types";
import { db } from "../client.js";
import { schedule, scheduleItem, scheduleScreenState } from "../schema/schedules.js";
import { screen } from "../schema/screens.js";
import { experience } from "../schema/projects.js";
import { mediaAsset } from "../schema/media.js";

/**
 * Schedules: playlists of content that run on chosen screens inside a time
 * window. The timing rules live in @platform/types (schedule.ts); this file
 * only stores and loads them.
 */

export interface ScheduleItemRow {
  id: string;
  kind: ScheduleContentKind;
  contentId: string;
  durationSeconds: number;
  /** The experience or media name; null when that content has been deleted. */
  title: string | null;
  /** media_asset.type for media items ("image", "video", …); null for experiences. */
  mediaType: string | null;
  /** A small preview for media items, when there is one. */
  thumbnailUrl: string | null;
  /** The media file itself (e.g. to read a video's length); null for experiences. */
  mediaUrl: string | null;
}

export interface ScheduleRow {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  priority: number;
  startDate: string | null;
  endDate: string | null;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  loop: boolean;
  /** Play once only: the media shown afterwards (null = the screens' idle screen, or it was deleted). */
  afterMedia: { id: string; name: string; type: string; url: string; thumbnailUrl: string | null } | null;
  screenIds: string[];
  groupIds: string[];
  items: ScheduleItemRow[];
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleInput {
  name: string;
  color: string;
  enabled: boolean;
  priority: number;
  startDate: string | null;
  endDate: string | null;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  loop: boolean;
  afterMediaId: string | null;
  screenIds: string[];
  groupIds: string[];
  items: { kind: ScheduleContentKind; contentId: string; durationSeconds: number }[];
}

/** Every schedule with its playlist, highest priority first. */
export async function listSchedules(): Promise<ScheduleRow[]> {
  const [schedules, items] = await Promise.all([
    db.select().from(schedule).orderBy(desc(schedule.priority), asc(schedule.createdAt)),
    db
      .select({
        id: scheduleItem.id,
        scheduleId: scheduleItem.scheduleId,
        position: scheduleItem.position,
        kind: scheduleItem.contentKind,
        experienceId: scheduleItem.experienceId,
        mediaAssetId: scheduleItem.mediaAssetId,
        durationSeconds: scheduleItem.durationSeconds,
        experienceName: experience.name,
        mediaName: mediaAsset.name,
        mediaType: mediaAsset.type,
        mediaUrl: mediaAsset.url,
        mediaThumb: mediaAsset.thumbnailUrl,
      })
      .from(scheduleItem)
      // Soft-deleted content counts as gone: the item stays (so the editor can
      // say so) but has no title, and the scheduler skips it.
      .leftJoin(experience, and(eq(scheduleItem.experienceId, experience.id), isNull(experience.deletedAt)))
      .leftJoin(mediaAsset, and(eq(scheduleItem.mediaAssetId, mediaAsset.id), isNull(mediaAsset.deletedAt)))
      .orderBy(asc(scheduleItem.scheduleId), asc(scheduleItem.position)),
  ]);

  // The "afterwards" media of play-once schedules, still in the library.
  const afterIds = [...new Set(schedules.map((s) => s.afterMediaAssetId).filter((id): id is string => !!id))];
  const afterRows = afterIds.length
    ? await db
        .select({ id: mediaAsset.id, name: mediaAsset.name, type: mediaAsset.type, url: mediaAsset.url, thumbnailUrl: mediaAsset.thumbnailUrl })
        .from(mediaAsset)
        .where(and(inArray(mediaAsset.id, afterIds), isNull(mediaAsset.deletedAt)))
    : [];
  const afterById = new Map(afterRows.map((m) => [m.id, m]));

  const bySchedule = new Map<string, ScheduleItemRow[]>();
  for (const i of items) {
    const kind = i.kind === "experience" ? "experience" : "media";
    const row: ScheduleItemRow = {
      id: i.id,
      kind,
      contentId: (kind === "experience" ? i.experienceId : i.mediaAssetId) ?? "",
      durationSeconds: i.durationSeconds,
      title: kind === "experience" ? i.experienceName : i.mediaName,
      mediaType: kind === "media" ? i.mediaType : null,
      thumbnailUrl: kind === "media" ? (i.mediaThumb ?? (i.mediaType === "image" ? i.mediaUrl : null)) : null,
      mediaUrl: kind === "media" ? i.mediaUrl : null,
    };
    const list = bySchedule.get(i.scheduleId) ?? [];
    list.push(row);
    bySchedule.set(i.scheduleId, list);
  }

  return schedules.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    enabled: s.enabled,
    priority: s.priority,
    startDate: s.startDate,
    endDate: s.endDate,
    daysOfWeek: s.daysOfWeek,
    startTime: s.startTime,
    endTime: s.endTime,
    timezone: s.timezone,
    loop: s.loop,
    afterMedia: (s.afterMediaAssetId && afterById.get(s.afterMediaAssetId)) || null,
    screenIds: s.screenIds,
    groupIds: s.groupIds,
    items: bySchedule.get(s.id) ?? [],
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));
}

/** The timing view of a schedule, without items whose content is gone. */
export function toScheduleSpec(row: ScheduleRow): ScheduleSpec {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    priority: row.priority,
    startDate: row.startDate,
    endDate: row.endDate,
    daysOfWeek: row.daysOfWeek,
    startTime: row.startTime,
    endTime: row.endTime,
    timezone: row.timezone,
    loop: row.loop,
    afterMediaId: row.afterMedia?.id ?? null,
    activeFrom: row.updatedAt,
    items: row.items
      .filter((i) => i.title !== null && i.contentId)
      .map((i) => ({ id: i.id, kind: i.kind, contentId: i.contentId, durationSeconds: i.durationSeconds })),
    createdAt: row.createdAt,
  };
}

export async function scheduleExists(id: string): Promise<boolean> {
  const [row] = await db.select({ id: schedule.id }).from(schedule).where(eq(schedule.id, id)).limit(1);
  return Boolean(row);
}

function scheduleValues(input: ScheduleInput) {
  return {
    name: input.name,
    color: input.color,
    enabled: input.enabled,
    priority: input.priority,
    startDate: input.startDate,
    endDate: input.endDate,
    daysOfWeek: input.daysOfWeek,
    startTime: input.startTime,
    endTime: input.endTime,
    timezone: input.timezone,
    loop: input.loop,
    afterMediaAssetId: input.afterMediaId,
    screenIds: input.screenIds,
    groupIds: input.groupIds,
  };
}

function itemValues(scheduleId: string, items: ScheduleInput["items"]) {
  return items.map((i, position) => ({
    scheduleId,
    position,
    contentKind: i.kind,
    experienceId: i.kind === "experience" ? i.contentId : null,
    mediaAssetId: i.kind === "media" ? i.contentId : null,
    durationSeconds: i.durationSeconds,
  }));
}

export async function createSchedule(input: ScheduleInput, createdByUserId: string | null): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schedule)
      .values({ ...scheduleValues(input), createdByUserId })
      .returning({ id: schedule.id });
    if (!row) throw new Error("Failed to create schedule");
    if (input.items.length) await tx.insert(scheduleItem).values(itemValues(row.id, input.items));
    return row;
  });
}

/** Replace a schedule's settings and its whole playlist. */
export async function updateSchedule(id: string, input: ScheduleInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(schedule)
      .set({ ...scheduleValues(input), updatedAt: new Date() })
      .where(eq(schedule.id, id));
    await tx.delete(scheduleItem).where(eq(scheduleItem.scheduleId, id));
    if (input.items.length) await tx.insert(scheduleItem).values(itemValues(id, input.items));
  });
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<void> {
  await db.update(schedule).set({ enabled, updatedAt: new Date() }).where(eq(schedule.id, id));
}

export async function deleteSchedule(id: string): Promise<void> {
  await db.delete(schedule).where(eq(schedule.id, id));
}

// ─── For the scheduler ────────────────────────────────────────────────────────

export interface SchedulerScreenRow {
  screenId: string;
  screenName: string;
  groupId: string | null;
  currentContentKind: string | null;
  currentExperienceId: string | null;
  currentMediaAssetId: string | null;
  blanked: boolean;
  whiteboardActive: boolean;
}

export async function listScreensForScheduler(): Promise<SchedulerScreenRow[]> {
  return db
    .select({
      screenId: screen.screenId,
      screenName: screen.screenName,
      groupId: screen.groupId,
      currentContentKind: screen.currentContentKind,
      currentExperienceId: screen.currentExperienceId,
      currentMediaAssetId: screen.currentMediaAssetId,
      blanked: screen.blanked,
      whiteboardActive: screen.whiteboardActive,
    })
    .from(screen)
    .where(isNull(screen.deletedAt))
    .orderBy(asc(screen.position), desc(screen.createdAt));
}

/** Whether a schedule targets a screen, directly or through the screen's group. */
export function scheduleTargetsScreen(
  row: Pick<ScheduleRow, "screenIds" | "groupIds">,
  s: Pick<SchedulerScreenRow, "screenId" | "groupId">
): boolean {
  return row.screenIds.includes(s.screenId) || (s.groupId !== null && row.groupIds.includes(s.groupId));
}

export async function listScheduleScreenStates(): Promise<ScheduleScreenStateRow[]> {
  const rows = await db.select().from(scheduleScreenState);
  return rows.map((r) => ({ ...r, appliedAt: r.appliedAt.toISOString() }));
}

export interface ScheduleScreenStateRow {
  screenId: string;
  scheduleId: string;
  itemKey: string;
  contentKind: string;
  contentId: string;
  previousContentKind: string | null;
  previousContentId: string | null;
  appliedAt: string;
}

export async function upsertScheduleScreenState(
  state: Omit<ScheduleScreenStateRow, "appliedAt">
): Promise<void> {
  const values = { ...state, appliedAt: new Date() };
  await db
    .insert(scheduleScreenState)
    .values(values)
    .onConflictDoUpdate({ target: scheduleScreenState.screenId, set: values });
}

export async function deleteScheduleScreenState(screenId: string): Promise<void> {
  await db.delete(scheduleScreenState).where(eq(scheduleScreenState.screenId, screenId));
}
