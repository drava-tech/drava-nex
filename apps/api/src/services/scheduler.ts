import {
  pool,
  deleteScheduleScreenState,
  listScheduleScreenStates,
  listSchedules,
  listScreensForScheduler,
  scheduleTargetsScreen,
  setScreenExperience,
  setScreenMedia,
  toScheduleSpec,
  upsertScheduleScreenState,
  type ScheduleRow,
  type ScheduleScreenStateRow,
  type SchedulerScreenRow,
} from "@platform/db";
import {
  nextWindowStart,
  resolveSchedules,
  type ScheduleContentKind,
  type ScheduleResolution,
  type ScheduleSpec,
} from "@platform/types";
import { pushScreenContent } from "../routes/screens.js";
import {
  anyMotionPlaying,
  currentMotionTriggers,
  motionResolutionFor,
  setMotionFiredHandler,
} from "./motion-triggers.js";
import type { MotionTriggerRow } from "@platform/db";
import { clearTakeoverFlag, getConnectedScreenIds } from "../ws/gateway.js";

/**
 * The scheduler: keeps every screen showing what its schedules say it should.
 *
 * Each tick resolves, per screen, the schedule on air (highest priority wins)
 * and the playlist item due now (@platform/types resolveSchedules), and acts
 * only when that changes — tracked per screen in schedule_screen_state:
 *
 *   - the schedule moves on to a new item → push it (unless the screen
 *     already shows that content, e.g. a one-item loop);
 *   - someone pushes something by hand meanwhile → it stays up until the next
 *     item is due (the state's item key hasn't changed, so nothing happens);
 *   - the schedule runs its course (its window ends, or a play-once queue
 *     finishes) → the media chosen for afterwards, or the idle screen; a
 *     schedule taken away (deleted, switched off, the screen removed from it)
 *     puts back what the screen showed before. Only if it still shows the
 *     schedule's content (a manual push since then is left alone);
 *   - a screen that is Stopped (blanked) or has a live whiteboard is left
 *     alone until that ends.
 *
 * Ticks are timed to the next change (at most every 5s, at least every 1s),
 * so items switch on time without polling the database every second.
 */

/**
 * Only ONE scheduler may drive the screens, and it should be the production
 * API — the screens are connected to it, and dev machines share its database.
 * Two schedulers on one database fight at every item change (their clocks
 * differ by a moment, and their code versions may differ), which shows up as
 * a flicker on the wall.
 *
 *   - It runs when NODE_ENV=production (the API's Docker image), or when
 *     SCHEDULER_ENABLED=true; SCHEDULER_ENABLED=false turns it off anywhere.
 *   - Even then, it only acts while it holds a Postgres advisory lock, so two
 *     enabled APIs on one database still take turns rather than both pushing.
 */
export function schedulerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env["SCHEDULER_ENABLED"]?.trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return env["NODE_ENV"] === "production";
}

/** Any fixed number; the same in every API so they contend for one lock. */
const LEADER_LOCK_KEY = 0x4e455853; // "NEXS"
const LEADER_RETRY_MS = 30_000;
/** The bits of a pg pool client the lock needs (the pg types live in @platform/db). */
type PoolClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ ok?: boolean }> }>;
  release: () => void;
  on: (event: "error", listener: () => void) => unknown;
};
let leaderClient: PoolClient | null = null;

/** Hold the scheduler lock on a dedicated connection; true while we have it. */
async function holdLeadership(): Promise<boolean> {
  if (leaderClient) return true;
  let client: PoolClient | null = null;
  try {
    client = (await pool.connect()) as unknown as PoolClient;
    const { rows } = await client.query("select pg_try_advisory_lock($1) as ok", [LEADER_LOCK_KEY]);
    if (rows[0]?.ok) {
      leaderClient = client;
      // If this connection dies, the lock goes with it; try again next tick.
      client.on("error", () => {
        leaderClient = null;
      });
      console.info("[scheduler] driving the screens (holds the scheduler lock)");
      return true;
    }
    client.release();
    return false;
  } catch (err) {
    client?.release();
    console.error("[scheduler] couldn't take the scheduler lock:", err);
    return false;
  }
}

const MAX_TICK_MS = 5_000;
const MIN_TICK_MS = 1_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let rerun = false;
let started = false;

type Showing = { kind: ScheduleContentKind; id: string } | null;

function showingOf(s: SchedulerScreenRow): Showing {
  if (s.currentContentKind === "experience" && s.currentExperienceId) return { kind: "experience", id: s.currentExperienceId };
  if (s.currentContentKind === "media" && s.currentMediaAssetId) return { kind: "media", id: s.currentMediaAssetId };
  return null;
}

const isShowing = (s: SchedulerScreenRow, kind: string | null, id: string | null) => {
  const now = showingOf(s);
  return now !== null && now.kind === kind && now.id === id;
};

async function assign(screenId: string, kind: string | null, id: string | null): Promise<void> {
  if (kind === "experience" && id) await setScreenExperience(screenId, id, { record: false });
  else await setScreenMedia(screenId, kind === "media" ? id : null, { record: false });
  // Same as a manual push: an explicit assignment beats a stale camera takeover.
  clearTakeoverFlag(screenId);
  await pushScreenContent(screenId);
}

/** Bring one screen in line with its resolution. Returns true if it pushed. */
async function applyToScreen(
  s: SchedulerScreenRow,
  res: ScheduleResolution | null,
  state: ScheduleScreenStateRow | undefined,
  /** The schedule the screen's state came from, while it exists and still targets this screen. */
  stateSpec?: ScheduleSpec
): Promise<boolean> {
  if (s.blanked || s.whiteboardActive) return false;

  if (res) {
    const { kind, contentId } = res.position.item;
    // Same item, same content as last time: nothing to do (and a manual push
    // made since then stays up).
    if (state && state.itemKey === res.key && state.contentKind === kind && state.contentId === contentId) return false;
    let pushed = false;
    if (!isShowing(s, kind, contentId)) {
      await assign(s.screenId, kind, contentId);
      pushed = true;
    }
    const before = state ? { kind: state.previousContentKind, id: state.previousContentId } : showingOf(s);
    await upsertScheduleScreenState({
      screenId: s.screenId,
      scheduleId: res.schedule.id,
      itemKey: res.key,
      contentKind: kind,
      contentId,
      previousContentKind: before?.kind ?? null,
      previousContentId: before?.id ?? null,
    });
    return pushed;
  }

  if (state) {
    // The schedule is over here. If it ran its course (a loop whose slot
    // ended, a play-once queue that finished), the screen shows the media
    // chosen for afterwards, or goes idle. If it was taken away instead
    // (deleted, switched off, the screen taken out of it), the screen gets
    // back what it showed before. Either way, only if it still shows the
    // schedule's content — a manual push since then is left alone.
    // (stateSpec is only passed while the schedule still targets this screen.)
    const ranItsCourse = !!stateSpec && stateSpec.enabled;
    let pushed = false;
    if (isShowing(s, state.contentKind, state.contentId)) {
      if (ranItsCourse) await assign(s.screenId, stateSpec.afterMediaId ? "media" : null, stateSpec.afterMediaId);
      else await assign(s.screenId, state.previousContentKind, state.previousContentId);
      pushed = true;
    }
    await deleteScheduleScreenState(s.screenId);
    return pushed;
  }
  return false;
}

interface Snapshot {
  rows: ScheduleRow[];
  specs: Map<string, ScheduleSpec>;
  screens: SchedulerScreenRow[];
  states: Map<string, ScheduleScreenStateRow>;
}

async function snapshot(): Promise<Snapshot> {
  const [rows, screens, states] = await Promise.all([
    listSchedules(),
    listScreensForScheduler(),
    listScheduleScreenStates(),
  ]);
  return {
    rows,
    specs: new Map(rows.map((r) => [r.id, toScheduleSpec(r)])),
    screens,
    states: new Map(states.map((st) => [st.screenId, st])),
  };
}

function specsFor(snap: Snapshot, s: SchedulerScreenRow): ScheduleSpec[] {
  return snap.rows.filter((r) => scheduleTargetsScreen(r, s)).map((r) => snap.specs.get(r.id)!);
}

/** Loaded only while a motion trigger is playing somewhere. */
async function motionRowsNow(now: Date): Promise<MotionTriggerRow[]> {
  return anyMotionPlaying(now.getTime()) ? currentMotionTriggers() : [];
}

/**
 * What a screen should show: a motion trigger playing on it wins (it's a
 * moment's takeover), otherwise its schedules decide.
 */
function resolveScreen(snap: Snapshot, s: SchedulerScreenRow, motionRows: MotionTriggerRow[], now: Date): ScheduleResolution | null {
  const scheduled = resolveSchedules(specsFor(snap, s), now);
  const motion = motionRows.length
    ? motionResolutionFor((row) => scheduleTargetsScreen(row, s), motionRows, now.getTime())
    : null;
  if (!motion) return scheduled;
  if (scheduled) motion.overridden = [scheduled.schedule];
  return motion;
}

async function tick(): Promise<number> {
  const now = new Date();
  const snap = await snapshot();
  const motionRows = await motionRowsNow(now);
  let soonest = MAX_TICK_MS / 1000;
  for (const s of snap.screens) {
    const res = resolveScreen(snap, s, motionRows, now);
    if (res) soonest = Math.min(soonest, res.changesInSeconds);
    try {
      const state = snap.states.get(s.screenId);
      // The schedule the state came from, while it still exists and still targets this screen.
      const stateRow = state ? snap.rows.find((r) => r.id === state.scheduleId) : undefined;
      const stateSpec = stateRow && scheduleTargetsScreen(stateRow, s) ? snap.specs.get(stateRow.id) : undefined;
      await applyToScreen(s, res, state, stateSpec);
    } catch (err) {
      console.error(`[scheduler] couldn't update "${s.screenId}":`, err);
    }
  }
  // Wake just after the next change is due.
  return Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, soonest * 1000 + 150));
}

function schedule(delay: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, delay);
}

async function run(): Promise<void> {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  let delay = MAX_TICK_MS;
  try {
    // Another API is driving the screens: stay out of its way, check back later.
    if (!(await holdLeadership())) {
      running = false;
      schedule(LEADER_RETRY_MS);
      return;
    }
    delay = await tick();
  } catch (err) {
    console.error("[scheduler] tick failed:", err);
  } finally {
    running = false;
  }
  if (rerun) {
    rerun = false;
    delay = 0;
  }
  schedule(delay);
}

/** One pass over every screen, as the timer runs it. Exported for tests. */
export const runSchedulerTick = tick;

export function startScheduler(): void {
  if (started) return;
  if (!schedulerEnabled()) {
    console.info(
      "[scheduler] off here (not production). Set SCHEDULER_ENABLED=true to run it; " +
        "only one API should drive the screens."
    );
    return;
  }
  started = true;
  // A motion trigger firing should reach the screens at once, not next tick.
  setMotionFiredHandler(runSchedulerSoon);
  // A short delay so the screens have reconnected after a restart; the state
  // table means nothing is re-pushed that is already right.
  schedule(3_000);
  console.info("[scheduler] running");
}

/** Re-evaluate right away, e.g. after a schedule was created or edited. */
export function runSchedulerSoon(): void {
  if (!started) return;
  schedule(250);
}

// ─── Status for the CMS ("now playing / up next") ────────────────────────────

export interface ScreenScheduleStatus {
  screenId: string;
  screenName: string;
  groupId: string | null;
  online: boolean;
  /** Why the scheduler is holding off this screen right now, if it is. */
  paused: "stopped" | "whiteboard" | null;
  current: {
    scheduleId: string;
    scheduleName: string;
    itemIndex: number;
    itemCount: number;
    kind: ScheduleContentKind;
    contentId: string;
    /** ISO: when the next item is due (or the window ends, if sooner). */
    changesAt: string;
    itemStartedAt: string;
    windowEndsAt: string;
    /** Someone pushed something else by hand; it stays until changesAt. */
    manualOverride: boolean;
    /** Schedules also on air here that lost on priority. */
    overriddenNames: string[];
  } | null;
  /** The next schedule window to start on this screen, if any in the next two weeks. */
  next: { scheduleId: string; scheduleName: string; startsAt: string } | null;
}

export async function scheduleStatus(now = new Date()): Promise<ScreenScheduleStatus[]> {
  const snap = await snapshot();
  const motionRows = await motionRowsNow(now);
  const online = new Set(getConnectedScreenIds());
  const t = now.getTime();
  return snap.screens.map((s) => {
    const specs = specsFor(snap, s);
    const res = resolveScreen(snap, s, motionRows, now);
    const state = snap.states.get(s.screenId);
    let next: ScreenScheduleStatus["next"] = null;
    for (const spec of specs) {
      if (!spec.enabled || spec.items.length === 0) continue;
      const start = nextWindowStart(spec, now);
      if (start && (!next || start.getTime() < Date.parse(next.startsAt))) {
        next = { scheduleId: spec.id, scheduleName: spec.name, startsAt: start.toISOString() };
      }
    }
    return {
      screenId: s.screenId,
      screenName: s.screenName,
      groupId: s.groupId,
      online: online.has(s.screenId),
      paused: s.blanked ? "stopped" : s.whiteboardActive ? "whiteboard" : null,
      current: res
        ? {
            scheduleId: res.schedule.id,
            scheduleName: res.schedule.name,
            itemIndex: res.position.index,
            itemCount: res.schedule.items.length,
            kind: res.position.item.kind,
            contentId: res.position.item.contentId,
            changesAt: new Date(t + res.changesInSeconds * 1000).toISOString(),
            itemStartedAt: new Date(t - res.position.itemElapsedSeconds * 1000).toISOString(),
            windowEndsAt: new Date(t + res.window.remainingSeconds * 1000).toISOString(),
            manualOverride:
              !!state && state.itemKey === res.key && !isShowing(s, res.position.item.kind, res.position.item.contentId),
            overriddenNames: res.overridden.map((o) => o.name),
          }
        : null,
      next,
    };
  });
}
