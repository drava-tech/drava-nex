import { listMotionTriggers, type MotionTriggerRow } from "@platform/db";
import { activeWindow, ALL_DAYS, type ScheduleResolution, type ScheduleSpec } from "@platform/types";
import { onHomeAssistantStateChange } from "./home-assistant-ingest.js";

/**
 * Motion triggers: "when this sensor sees someone, play this on these screens".
 *
 * A sensor event (Home Assistant's binary_sensor turning on, or a call to
 * POST /api/motion-triggers/fire) fires every trigger set up for that sensor,
 * unless it's outside the trigger's hours, already playing, or still in its
 * cooldown after the last play. A fired trigger plays for its duration; the
 * scheduler shows it over whatever the screens were on (a schedule included),
 * then lets them go back — see motionResolutionFor and scheduler.ts.
 *
 * What's playing lives in memory: a trigger is a moment, not a setting, and a
 * restart simply ends it early.
 */

interface Playing {
  firedAt: number;
  until: number;
}

const playing = new Map<string, Playing>(); // by trigger id
const lastPlayed = new Map<string, Playing>(); // for the cooldown, by trigger id

let cache: { rows: MotionTriggerRow[]; at: number } | null = null;
const CACHE_MS = 30_000;

/** The triggers as set up, cached briefly (sensor events can be frequent). */
export async function currentMotionTriggers(): Promise<MotionTriggerRow[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) cache = { rows: await listMotionTriggers(), at: Date.now() };
  return cache.rows;
}

/** After a trigger is created, edited or deleted. */
export function invalidateMotionTriggers(): void {
  cache = null;
}

let onFired: () => void = () => {};
/** The scheduler registers here to re-run as soon as something fires. */
export function setMotionFiredHandler(handler: () => void): void {
  onFired = handler;
}

/** Whether the trigger may fire at `now` by its hours and days. */
export function withinTriggerHours(row: Pick<MotionTriggerRow, "startTime" | "endTime" | "daysOfWeek" | "timezone">, now: number): boolean {
  const spec = {
    id: "",
    name: "",
    enabled: true,
    priority: 0,
    startDate: null,
    endDate: null,
    daysOfWeek: row.daysOfWeek,
    startTime: row.startTime,
    endTime: row.endTime,
    timezone: row.timezone,
    loop: true,
    afterMediaId: null,
    items: [],
    createdAt: "",
  } satisfies ScheduleSpec;
  return activeWindow(spec, new Date(now)) !== null;
}

export type FireOutcome =
  | { triggerId: string; name: string; fired: true; until: string }
  | { triggerId: string; name: string; fired: false; reason: "no content" | "outside its hours" | "already playing" | "cooling down" };

/** Start one trigger now. `force` (the Test button) ignores its hours and cooldown. */
export function startTrigger(row: MotionTriggerRow, now = Date.now(), force = false): FireOutcome {
  const base = { triggerId: row.id, name: row.name };
  if (!row.media) return { ...base, fired: false, reason: "no content" };
  const current = playing.get(row.id);
  if (current && current.until > now) return { ...base, fired: false, reason: "already playing" };
  if (!force && !withinTriggerHours(row, now)) return { ...base, fired: false, reason: "outside its hours" };
  const last = lastPlayed.get(row.id);
  if (!force && last && now < last.until + row.cooldownSeconds * 1000) return { ...base, fired: false, reason: "cooling down" };
  const run = { firedAt: now, until: now + row.durationSeconds * 1000 };
  playing.set(row.id, run);
  lastPlayed.set(row.id, run);
  onFired();
  return { ...base, fired: true, until: new Date(run.until).toISOString() };
}

/** A sensor saw motion: fire every trigger set up for it (sensor ids match case-insensitively). */
export async function fireMotionSensor(sensorId: string, now = Date.now()): Promise<FireOutcome[]> {
  const id = sensorId.trim().toLowerCase();
  if (!id) return [];
  const rows = (await currentMotionTriggers()).filter((r) => r.sensorId.trim().toLowerCase() === id);
  const outcomes = rows.map((r) => startTrigger(r, now));
  for (const o of outcomes) {
    console.info(`[motion] ${sensorId} → "${o.name}": ${o.fired ? `playing until ${o.until}` : o.reason}`);
  }
  return outcomes;
}

/** Whether anything is playing now — lets the scheduler skip loading triggers otherwise. */
export function anyMotionPlaying(now = Date.now()): boolean {
  for (const p of playing.values()) if (p.until > now) return true;
  return false;
}

/** For the CMS: what each trigger is doing. */
export function motionTriggerStatus(now = Date.now()): Record<string, { playingUntil: string | null; lastFiredAt: string | null; readyAt: string | null }> {
  const out: Record<string, { playingUntil: string | null; lastFiredAt: string | null; readyAt: string | null }> = {};
  for (const row of cache?.rows ?? []) {
    const p = playing.get(row.id);
    const last = lastPlayed.get(row.id);
    const readyAt = last ? last.until + row.cooldownSeconds * 1000 : null;
    out[row.id] = {
      playingUntil: p && p.until > now ? new Date(p.until).toISOString() : null,
      lastFiredAt: last ? new Date(last.firedAt).toISOString() : null,
      readyAt: readyAt && readyAt > now ? new Date(readyAt).toISOString() : null,
    };
  }
  return out;
}

/**
 * The motion trigger playing on a screen now, as a resolution the scheduler
 * can apply like a schedule's (it wins over schedules: the most recently
 * fired one, if several cover the screen). null when none is playing there.
 */
export function motionResolutionFor(
  targets: (row: MotionTriggerRow) => boolean,
  rows: MotionTriggerRow[],
  now = Date.now()
): ScheduleResolution | null {
  let best: { row: MotionTriggerRow; run: Playing } | null = null;
  for (const row of rows) {
    const run = playing.get(row.id);
    if (!run || run.until <= now || !row.media || !targets(row)) continue;
    if (!best || run.firedAt > best.run.firedAt) best = { row, run };
  }
  if (!best) return null;
  const { row, run } = best;
  const elapsed = (now - run.firedAt) / 1000;
  const remaining = (run.until - now) / 1000;
  const item = { id: `motion-${row.id}`, kind: "media" as const, contentId: row.media!.id, durationSeconds: row.durationSeconds };
  const spec: ScheduleSpec = {
    id: `motion:${row.id}`,
    name: `Motion: ${row.name}`,
    enabled: true,
    priority: Number.MAX_SAFE_INTEGER,
    startDate: null,
    endDate: null,
    daysOfWeek: ALL_DAYS,
    startTime: null,
    endTime: null,
    timezone: row.timezone,
    loop: false,
    afterMediaId: null,
    items: [item],
    createdAt: row.createdAt,
  };
  return {
    schedule: spec,
    window: { date: "", elapsedSeconds: elapsed, remainingSeconds: remaining },
    position: { index: 0, item, cycle: 0, itemElapsedSeconds: elapsed, itemRemainingSeconds: remaining },
    // One key per firing, so a new firing (after the cooldown) plays afresh.
    key: `motion:${row.id}:${run.firedAt}`,
    changesInSeconds: remaining,
    overridden: [],
  };
}

let started = false;
/** Listen to Home Assistant: a binary_sensor turning on is motion. */
export function startMotionTriggers(): void {
  if (started) return;
  started = true;
  onHomeAssistantStateChange((change) => {
    if (!change.entityId.startsWith("binary_sensor.")) return;
    if (change.state !== "on" || change.previousState === "on") return;
    void fireMotionSensor(change.entityId).catch((err) => console.error("[motion] couldn't fire:", err));
  });
}

/** Test hook: forget what's playing and cooling down. */
export function resetMotionState(): void {
  playing.clear();
  lastPlayed.clear();
  cache = null;
}
