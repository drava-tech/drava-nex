import type { ScheduleRow } from "@platform/db";
import type { ScheduleSpec } from "@platform/types";

/**
 * The timing view of a schedule row, for the client — the same mapping as
 * @platform/db's toScheduleSpec, which can't be imported into the browser
 * bundle (it lives next to the database client).
 */
export function toScheduleSpecClient(row: ScheduleRow): ScheduleSpec {
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
    items: row.items
      .filter((i) => i.title !== null && i.contentId)
      .map((i) => ({ id: i.id, kind: i.kind, contentId: i.contentId, durationSeconds: i.durationSeconds })),
    createdAt: row.createdAt,
  };
}
