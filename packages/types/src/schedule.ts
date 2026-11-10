// Screen scheduling: which content a screen should be showing at a moment,
// from the schedules that target it. Pure functions with no I/O, shared by
// the API's scheduler (which applies the answer to the screens) and the CMS
// (which shows "now playing / up next" and the week view), so both always
// agree on what is on air.
//
// A schedule is a playlist (ordered items, each shown for a number of
// seconds, looping) that runs inside a time window: a daily window (or all
// day), on chosen weekdays, optionally between two dates, in the schedule's
// own timezone. A window may run past midnight ("22:00"–"06:00"); it then
// belongs to the day it starts on.
//
// Position in the playlist is computed from the time since the window
// started, not from a timer, so every screen on a schedule shows the same item
// at the same moment and a restart resumes exactly where it was.

export type ScheduleContentKind = "experience" | "media";

export interface ScheduleItemSpec {
  id: string;
  kind: ScheduleContentKind;
  /** experience.id or media_asset.id, by kind. */
  contentId: string;
  durationSeconds: number;
}

export interface ScheduleSpec {
  id: string;
  name: string;
  enabled: boolean;
  /** Higher wins when two schedules cover the same screen at the same time. */
  priority: number;
  /** "YYYY-MM-DD", inclusive, in the schedule's timezone; null = open-ended. */
  startDate: string | null;
  endDate: string | null;
  /** 0 = Sunday … 6 = Saturday. */
  daysOfWeek: number[];
  /** "HH:MM" 24-hour; both null = all day. Equal = a full 24 hours from that time. */
  startTime: string | null;
  endTime: string | null;
  /** IANA name, e.g. "Asia/Kolkata". */
  timezone: string;
  items: ScheduleItemSpec[];
  /**
   * true: the queue repeats until the window ends. false: it plays once, and
   * the schedule is off air for the rest of the window.
   */
  loop: boolean;
  /**
   * For a queue that plays once: the image or video the screens show after
   * it finishes. null = their normal idle screen.
   */
  afterMediaId: string | null;
  /**
   * ISO time the schedule was last saved. If that falls inside a window
   * already running (saved at 10:10 for 10:00–11:00), the queue starts from
   * its first item at that moment rather than as if it had been playing since
   * 10:00 — otherwise a short play-once queue would already be "over".
   */
  activeFrom?: string | null;
  /** ISO timestamp; breaks priority ties (the newer schedule wins). */
  createdAt: string;
}

export const SCHEDULE_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [0, 6];
export const DEFAULT_SCHEDULE_TIMEZONE = "Asia/Kolkata";
/** Sensible starting durations for a new playlist item, in seconds. */
export const DEFAULT_ITEM_SECONDS: Record<"image" | "video" | "experience" | "other", number> = {
  image: 15,
  video: 30,
  experience: 60,
  other: 30,
};
export const MIN_ITEM_SECONDS = 5;
export const MAX_ITEM_SECONDS = 24 * 60 * 60;

const DAY_MINUTES = 24 * 60;

// ─── Time helpers ────────────────────────────────────────────────────────────

/** "HH:MM" → minutes after midnight, or null if malformed. */
export function parseTimeOfDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatTimeOfDay(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  /** "YYYY-MM-DD" */
  date: string;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** minutes after local midnight */
  minutes: number;
  seconds: number;
}

/** The wall-clock date, weekday and time of `at` in `tz`. */
export function localParts(at: Date, tz: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(tz).formatToParts(at)) parts[p.type] = p.value;
  const weekday = SCHEDULE_DAY_LABELS.indexOf(parts.weekday as (typeof SCHEDULE_DAY_LABELS)[number]);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    seconds: Number(parts.second),
  };
}

/** "YYYY-MM-DD" shifted by whole days (calendar arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Weekday (0 = Sunday) of a "YYYY-MM-DD" calendar date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The instant at which the wall clock in `tz` reads `date` + `minutes`. */
export function zonedTimeToInstant(date: string, minutes: number, tz: string): Date {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  // Offset of tz at a given instant, in ms (local wall clock minus UTC).
  const offsetAt = (instant: number) => {
    const p = localParts(new Date(instant), tz);
    const [py, pm, pd] = p.date.split("-").map(Number) as [number, number, number];
    const asUtc = Date.UTC(py, pm - 1, pd, Math.floor(p.minutes / 60), p.minutes % 60, p.seconds);
    return asUtc - Math.floor(instant / 1000) * 1000;
  };
  let guess = wall - offsetAt(wall);
  // Once more, in case the guess crossed a DST change.
  guess = wall - offsetAt(guess);
  return new Date(guess);
}

// ─── Windows ─────────────────────────────────────────────────────────────────

/** Start and length of the daily window, in minutes; all day is 0 + 1440. */
export function windowBounds(spec: Pick<ScheduleSpec, "startTime" | "endTime">): { start: number; length: number } {
  const start = parseTimeOfDay(spec.startTime);
  const end = parseTimeOfDay(spec.endTime);
  if (start === null || end === null) return { start: 0, length: DAY_MINUTES };
  const length = end > start ? end - start : end - start + DAY_MINUTES; // equal → 24h
  return { start, length };
}

/** Whether the schedule runs on the window that starts on `date`. */
export function runsOnDate(spec: Pick<ScheduleSpec, "daysOfWeek" | "startDate" | "endDate">, date: string): boolean {
  if (spec.startDate && date < spec.startDate) return false;
  if (spec.endDate && date > spec.endDate) return false;
  return spec.daysOfWeek.includes(weekdayOf(date));
}

export interface ActiveWindow {
  /** The local date the window started on. */
  date: string;
  elapsedSeconds: number;
  remainingSeconds: number;
}

/** The window running at `at`, if any. Ignores `enabled` and items. */
export function activeWindow(spec: ScheduleSpec, at: Date): ActiveWindow | null {
  const now = localParts(at, spec.timezone);
  const { start, length } = windowBounds(spec);
  const nowSec = now.minutes * 60 + now.seconds;
  // The window that started today, or the one from yesterday still running.
  for (const back of [0, 1]) {
    const date = back ? addDays(now.date, -1) : now.date;
    const elapsed = nowSec + back * DAY_MINUTES * 60 - start * 60;
    if (elapsed < 0 || elapsed >= length * 60) continue;
    if (!runsOnDate(spec, date)) continue;
    return { date, elapsedSeconds: elapsed, remainingSeconds: length * 60 - elapsed };
  }
  return null;
}

/**
 * How long the schedule is actually on air each window, in minutes: the whole
 * window, or for a queue that plays once, just until it finishes.
 */
export function onAirMinutes(spec: ScheduleSpec): number {
  const { length } = windowBounds(spec);
  if (spec.loop) return length;
  return Math.min(length, Math.ceil(playlistSeconds(spec.items) / 60));
}

/** Each day's on-air slice, in local minutes, for the 7 days from `firstDate`. */
export function weekSegments(
  spec: ScheduleSpec,
  firstDate: string,
  days = 7
): { date: string; startMinute: number; endMinute: number }[] {
  const { start } = windowBounds(spec);
  const length = onAirMinutes(spec);
  if (length <= 0) return [];
  const out: { date: string; startMinute: number; endMinute: number }[] = [];
  // From the day before, for an overnight window spilling into the first day.
  for (let i = -1; i < days; i++) {
    const date = addDays(firstDate, i);
    if (!runsOnDate(spec, date)) continue;
    const end = start + length;
    if (i >= 0) out.push({ date, startMinute: start, endMinute: Math.min(end, DAY_MINUTES) });
    if (end > DAY_MINUTES && i + 1 < days) {
      out.push({ date: addDays(date, 1), startMinute: 0, endMinute: end - DAY_MINUTES });
    }
  }
  return out;
}

/** When the schedule's next window starts after `at` (up to `horizonDays` ahead). */
export function nextWindowStart(spec: ScheduleSpec, at: Date, horizonDays = 14): Date | null {
  const today = localParts(at, spec.timezone).date;
  const { start } = windowBounds(spec);
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDays(today, i);
    if (!runsOnDate(spec, date)) continue;
    const instant = zonedTimeToInstant(date, start, spec.timezone);
    if (instant.getTime() > at.getTime()) return instant;
  }
  return null;
}

// ─── Playlist ────────────────────────────────────────────────────────────────

export function playlistSeconds(items: Pick<ScheduleItemSpec, "durationSeconds">[]): number {
  return items.reduce((sum, i) => sum + Math.max(MIN_ITEM_SECONDS, i.durationSeconds), 0);
}

export interface PlaylistPosition {
  index: number;
  item: ScheduleItemSpec;
  /** How many times the playlist has fully looped this window. */
  cycle: number;
  itemElapsedSeconds: number;
  itemRemainingSeconds: number;
}

export function playlistPosition(
  items: ScheduleItemSpec[],
  elapsedSeconds: number,
  loop = true
): PlaylistPosition | null {
  const total = playlistSeconds(items);
  if (items.length === 0 || total <= 0) return null;
  // Played once and finished: nothing more this window.
  if (!loop && elapsedSeconds >= total) return null;
  const cycle = Math.floor(elapsedSeconds / total);
  let t = elapsedSeconds - cycle * total;
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    const d = Math.max(MIN_ITEM_SECONDS, item.durationSeconds);
    if (t < d) return { index, item, cycle, itemElapsedSeconds: t, itemRemainingSeconds: d - t };
    t -= d;
  }
  return null; // unreachable
}

// ─── Resolution ──────────────────────────────────────────────────────────────

export interface ScheduleResolution {
  schedule: ScheduleSpec;
  window: ActiveWindow;
  position: PlaylistPosition;
  /**
   * Identifies "this item, this time round": changes whenever the screen
   * should move on, even to the same content (a one-item loop).
   */
  key: string;
  /** Seconds until whichever comes first: the next item or the window's end. */
  changesInSeconds: number;
  /** Other schedules that are on air now but lost on priority. */
  overridden: ScheduleSpec[];
}

/** Highest priority first, then newest — the order conflicts are settled in. */
export function compareSchedules(a: ScheduleSpec, b: ScheduleSpec): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * How far into its queue a schedule is: from the window's start, or from when
 * it was saved if that was later in this same window (see activeFrom).
 */
export function queueElapsedSeconds(spec: Pick<ScheduleSpec, "activeFrom">, window: ActiveWindow, at: Date): number {
  if (!spec.activeFrom) return window.elapsedSeconds;
  const sinceSaved = (at.getTime() - Date.parse(spec.activeFrom)) / 1000;
  return sinceSaved >= 0 && sinceSaved < window.elapsedSeconds ? sinceSaved : window.elapsedSeconds;
}

/** What a screen should show at `at`, given the schedules that target it. */
export function resolveSchedules(specs: ScheduleSpec[], at: Date): ScheduleResolution | null {
  const live: { spec: ScheduleSpec; window: ActiveWindow; position: PlaylistPosition }[] = [];
  for (const spec of specs) {
    if (!spec.enabled || spec.items.length === 0) continue;
    const window = activeWindow(spec, at);
    if (!window) continue;
    const position = playlistPosition(spec.items, queueElapsedSeconds(spec, window, at), spec.loop);
    if (position) live.push({ spec, window, position });
  }
  if (live.length === 0) return null;
  live.sort((a, b) => compareSchedules(a.spec, b.spec));
  const winner = live[0]!;
  return {
    schedule: winner.spec,
    window: winner.window,
    position: winner.position,
    key: `${winner.spec.id}:${winner.window.date}:${winner.position.cycle}:${winner.position.index}`,
    changesInSeconds: Math.min(winner.position.itemRemainingSeconds, winner.window.remainingSeconds),
    overridden: live.slice(1).map((l) => l.spec),
  };
}

// ─── Conflicts (for the editor) ─────────────────────────────────────────────

/**
 * Whether two schedules can be on air at the same moment (ignoring targets):
 * some date both run on, with overlapping windows. Checked over the next
 * `horizonDays` days from `fromDate`.
 */
export function schedulesOverlap(a: ScheduleSpec, b: ScheduleSpec, fromDate: string, horizonDays = 35): boolean {
  const segA = weekSegments(a, fromDate, horizonDays);
  const segB = weekSegments(b, fromDate, horizonDays);
  return segA.some((x) =>
    segB.some((y) => x.date === y.date && x.startMinute < y.endMinute && y.startMinute < x.endMinute)
  );
}

// ─── Summary text ────────────────────────────────────────────────────────────

/** "Every day", "Weekdays", "Weekends", "Mon, Wed, Fri". */
export function describeDays(days: number[]): string {
  const set = [...new Set(days)].sort();
  if (set.length === 7) return "Every day";
  if (set.length === 0) return "No days";
  if (set.join() === WEEKDAYS.join()) return "Weekdays";
  if (set.join() === WEEKEND.join()) return "Weekends";
  return set.map((d) => SCHEDULE_DAY_LABELS[d]).join(", ");
}

/** "All day" or "09:00–18:00" (with "(next day)" for overnight windows). */
export function describeWindow(spec: Pick<ScheduleSpec, "startTime" | "endTime">): string {
  const start = parseTimeOfDay(spec.startTime);
  const end = parseTimeOfDay(spec.endTime);
  if (start === null || end === null) return "All day";
  return `${spec.startTime}–${spec.endTime}${end <= start ? " (next day)" : ""}`;
}

/**
 * Where each item of the queue falls on the clock during the first pass
 * through it, from the window's start: [startMinute, endMinute) in local
 * minutes after midnight (may pass 1440 for a window running past midnight),
 * and whether it starts before the window ends. For the editor's timeline.
 */
export function queueTimeline(
  spec: Pick<ScheduleSpec, "startTime" | "endTime">,
  items: Pick<ScheduleItemSpec, "durationSeconds">[]
): { startSecond: number; endSecond: number; fits: boolean; cutShort: boolean }[] {
  const { start, length } = windowBounds(spec);
  const windowStart = start * 60;
  const windowEnd = windowStart + length * 60;
  let t = windowStart;
  return items.map((i) => {
    const d = Math.max(MIN_ITEM_SECONDS, i.durationSeconds);
    const row = { startSecond: t, endSecond: t + d, fits: t < windowEnd, cutShort: t < windowEnd && t + d > windowEnd };
    t += d;
    return row;
  });
}

/** Seconds after midnight → "HH:MM" (or "HH:MM:SS" when it isn't on a minute). */
export function formatClock(secondsAfterMidnight: number): string {
  const s = ((Math.round(secondsAfterMidnight) % 86400) + 86400) % 86400;
  const hm = formatTimeOfDay(Math.floor(s / 60));
  return s % 60 ? `${hm}:${String(s % 60).padStart(2, "0")}` : hm;
}

/** "1m 30s", "45s", "2h 5m". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return sec ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
}
