import type { ScheduleRow } from "@platform/db";
import { toScheduleSpecClient } from "./to-spec";

export interface ScreenOption {
  screenId: string;
  screenName: string;
  groupId: string | null;
}

export interface GroupOption {
  id: string;
  name: string;
}

export interface ExperienceOption {
  id: string;
  title: string;
  coverImage: string | null;
}

/** Calendar colours offered in the editor; the first is the drava lime. */
export const SCHEDULE_COLORS = [
  "#92ff5f",
  "#66fff4",
  "#9ac8fc",
  "#c4a7ff",
  "#ff9bd2",
  "#ff7d6e",
  "#e29860",
  "#f2d45c",
];

/** Screens a schedule runs on: its own picks plus the members of its groups. */
export function targetScreenIds(row: Pick<ScheduleRow, "screenIds" | "groupIds">, screens: ScreenOption[]): string[] {
  const ids = new Set(row.screenIds);
  for (const s of screens) if (s.groupId && row.groupIds.includes(s.groupId)) ids.add(s.screenId);
  return screens.filter((s) => ids.has(s.screenId)).map((s) => s.screenId);
}

/** The playlist items the scheduler actually plays (deleted content is skipped). */
export function playableItems(row: ScheduleRow) {
  return row.items.filter((i) => i.title !== null && i.contentId);
}

export { toScheduleSpecClient };

/** "in 12s", "in 4m", "in 2h 5m". */
export function relativeIn(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `in ${h}h ${m % 60}m`;
}

/** "Today 09:00", "Tomorrow 18:30", "Wed 12 Nov, 09:00" — in the viewer's local time. */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}
