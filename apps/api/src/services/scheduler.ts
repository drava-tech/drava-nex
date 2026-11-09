import {
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
  activeWindow,
  nextWindowStart,
  resolveSchedules,
  type ScheduleContentKind,
  type ScheduleResolution,
  type ScheduleSpec,
} from "@platform/types";
import { pushScreenContent } from "../routes/screens.js";
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
 *   - the schedule's window ends → put back what the screen showed before the
 *     schedule took it over, but only if it still shows the schedule's
 *     content (a manual push since then is left alone);
 *   - a screen that is Stopped (blanked) or has a live whiteboard is left
 *     alone until that ends.
 *
 * Ticks are timed to the next change (at most every 5s, at least every 1s),
 * so items switch on time without polling the database every second.
 */

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
  /** The schedule the screen's state came from, if it still exists. */
  stateSpec?: ScheduleSpec,
  now = new Date()
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
    // The schedule is over. If it was a play-once queue that has finished
    // inside its slot, the screen goes to idle; otherwise (the slot ended,
    // the schedule was deleted) it gets back what it showed before. Either
    // way, only if it still shows the schedule's content — a manual push
    // since then is left alone.
    const playedOnce = !!stateSpec && !stateSpec.loop && activeWindow(stateSpec, now) !== null;
    let pushed = false;
    if (isShowing(s, state.contentKind, state.contentId)) {
      if (playedOnce) await assign(s.screenId, null, null);
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

async function tick(): Promise<number> {
  const now = new Date();
  const snap = await snapshot();
  let soonest = MAX_TICK_MS / 1000;
  for (const s of snap.screens) {
    const res = resolveSchedules(specsFor(snap, s), now);
    if (res) soonest = Math.min(soonest, res.changesInSeconds);
    try {
      const state = snap.states.get(s.screenId);
      await applyToScreen(s, res, state, state ? snap.specs.get(state.scheduleId) : undefined, now);
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
  started = true;
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
  const online = new Set(getConnectedScreenIds());
  const t = now.getTime();
  return snap.screens.map((s) => {
    const specs = specsFor(snap, s);
    const res = resolveSchedules(specs, now);
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
