import { MAIN_SCREEN_ID } from "./config.js";
import type { GreetingVoice } from "./voice.js";

/**
 * Decides what main-screen does for each flushed greeting batch, once per
 * flush, and owns the welcome screen's lifetime (revert timer, whiteboard watch,
 * startup clean-up). The welcome screen is always transient: it exists only
 * while a greeting is being delivered. A greeting is only ever spoken together
 * with the welcome screen, and never takes over a screen somebody is using:
 *
 *   offline                 -> nothing at all, and nothing recorded: no player is
 *                              connected, so the visitor is simply retried on
 *                              their next sighting
 *   idle                    -> push welcome-screen, start the revert timer, speak
 *   idle, but blanked       -> same, after clearing the black overlay the way the
 *                              operator routes do; the revert puts it back
 *   welcome already showing -> speak only: no push, timer untouched
 *   busy                    -> no voice, no screen change; the caller is told why
 *                              (GreetingRequest.onBusy) so it can record the
 *                              visitor as skipped. "Busy" is any of:
 *                                - a live whiteboard (checked first)
 *                                - blanked over content (or over the welcome screen)
 *                                - any content other than the default media
 *
 * The screen is classified BEFORE anyone is admitted to the daily gate, inside
 * one serialised step, from ONE database read (getState), so what is recorded
 * always matches what happened.
 *
 * "Idle" is the same rule as isScreenIdle() in @platform/db — nothing assigned,
 * or the screen's default media is what's playing — derived here from the
 * combined state row (see isIdleState; an integration test checks the two agree).
 *
 * Reverts restore what was showing before the welcome screen (a snapshot taken
 * when it was pushed): idle, or blanked with nothing behind it. Once anything
 * else has been assigned, the welcome screen never comes back and no revert or
 * watch touches the screen.
 *
 * Known limitations
 *  - Restart during a welcome screen that started from a blanked screen: it
 *    comes back idle and un-blanked. (The API's boot reset already clears every
 *    screen's blank state on each start, so this matches how a restart treats
 *    any blanked screen.)
 *  - "Idle" means nothing assigned or the default media; the snapshot restores
 *    that as "nothing assigned", which shows the default media the same way.
 */

/** The screen row, as the controller needs it (see getScreenGreetingState in @platform/db). */
export interface ScreenState {
  kind: string | null;
  currentMediaAssetId: string | null;
  defaultMediaAssetId: string | null;
  /** The assigned experience, if it exists and isn't soft-deleted. */
  experienceId: string | null;
  /** The persisted "Stop" state. */
  blanked: boolean;
  /** A whiteboard is active on the screen row. */
  whiteboardActive: boolean;
}

export interface ScreenDeps {
  /** One read of everything the controller classifies on; undefined if the screen doesn't exist. */
  getState(screenId: string): Promise<ScreenState | undefined>;
  /** A saved whiteboard is being pushed from the CMS right now (in memory). */
  isWhiteboardDocLive(screenId: string): boolean;
  /** At least one real (non-preview) player is connected. */
  isOnline(screenId: string): boolean;
  /** Must ignore soft-deleted experiences (getExperienceIdBySlug does). */
  getWelcomeExperienceId(): Promise<string | null>;
  setExperience(screenId: string, experienceId: string | null): Promise<void>;
  /** Blank / unblank the screen exactly like the operator routes: persisted AND live. */
  setBlank(screenId: string, blanked: boolean): Promise<void>;
  /** Re-resolve and broadcast what the screen should show. */
  push(screenId: string): Promise<unknown>;
}

/** Same rule as isScreenIdle() in @platform/db. */
export function isIdleState(state: ScreenState | undefined): boolean {
  if (!state) return false;
  if (state.kind === null) return true;
  return (
    state.kind === "media" &&
    state.defaultMediaAssetId !== null &&
    state.currentMediaAssetId === state.defaultMediaAssetId
  );
}

/** What to say for one flushed batch. */
export interface GreetingPresentation {
  /** The spoken line, or null when this batch is screen-only. */
  voiceText: string | null;
  /** Who is being greeted — for the log only; nothing on screen shows names. */
  names: string[];
}

export type BusyReason = "whiteboard" | "blanked" | "content";

/**
 * A batch of visitors due a greeting, as the controller sees it. It never looks
 * inside: it classifies the screen, then calls exactly one of these.
 */
export interface GreetingRequest {
  /** No player is connected: nothing is shown, said or recorded; the caller may log it. */
  onOffline(): Promise<void> | void;
  /** The screen is busy: nothing is shown or said. The caller records who was skipped. */
  onBusy(reason: BusyReason): Promise<void>;
  /**
   * The welcome screen is up or about to be: run the daily gate and return what
   * to say, or null when nobody is left to greet (all already greeted today).
   */
  admit(): Promise<GreetingPresentation | null>;
}

type Classified =
  | { kind: "offline" }
  | { kind: "welcome" }
  | { kind: "idle"; blanked: boolean }
  | { kind: "busy"; reason: BusyReason };

/** How the welcome screen ended, for the log. */
type RevertReason = "timer" | "startup" | "whiteboard-ended";

/** How often to check whether a whiteboard drawn over the welcome screen has ended. */
export const WHITEBOARD_WATCH_INTERVAL_MS = 3_000;
/** Give up watching after this long (the welcome screen is then left to the operator). */
export const WHITEBOARD_WATCH_MAX_MS = 60 * 60_000;

export class ScreenController {
  private revertTimer: ReturnType<typeof setTimeout> | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  /** What the screen looked like just before the current welcome screen was pushed (memory only). */
  private snapshot: { blanked: boolean } | null = null;

  constructor(
    private readonly deps: ScreenDeps,
    private readonly voice: GreetingVoice,
    private readonly welcomeDurationSeconds: number,
    private readonly screenId: string = MAIN_SCREEN_ID,
    /** Where failures go. If omitted they are logged here; the service passes its breaker. */
    private readonly onError?: (label: string, err: unknown) => void
  ) {}

  /**
   * Serialise screen decisions so concurrent flushes see each other's pushes.
   * Each queued decision catches its own failure and resolves to `fallback`, so
   * one error (DB unreachable, push failed) can never reject the chain and take
   * every later decision down with it.
   */
  private run<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(async () => {
      try {
        return await fn();
      } catch (err) {
        if (this.onError) this.onError(label, err);
        else console.error(`[greeting] ${label} failed:`, err);
        return fallback;
      }
    });
    this.chain = result;
    return result;
  }

  private isOnWelcome(state: ScreenState | undefined, welcomeId: string | null): boolean {
    return !!welcomeId && state?.kind === "experience" && state.experienceId === welcomeId;
  }

  private classify(state: ScreenState | undefined, welcomeId: string | null): Classified {
    if (!this.deps.isOnline(this.screenId)) return { kind: "offline" };
    if (!state) return { kind: "busy", reason: "content" }; // unknown screen row: never touch it
    if (state.whiteboardActive || this.deps.isWhiteboardDocLive(this.screenId)) {
      return { kind: "busy", reason: "whiteboard" };
    }
    if (this.isOnWelcome(state, welcomeId)) {
      // Welcome is assigned, but behind a black overlay nobody can see or hear it over.
      return state.blanked ? { kind: "busy", reason: "blanked" } : { kind: "welcome" };
    }
    if (isIdleState(state)) return { kind: "idle", blanked: state.blanked };
    return { kind: "busy", reason: state.blanked ? "blanked" : "content" };
  }

  /** Switch to the welcome screen, take the snapshot, and arm the one revert timer for this push. */
  private async switchToWelcome(welcomeId: string, wasBlanked: boolean): Promise<void> {
    await this.deps.setExperience(this.screenId, welcomeId);
    // Same order as the operator assign routes: assignment, then clear the live
    // black overlay, then push — otherwise the welcome screen would sit behind it.
    if (wasBlanked) await this.deps.setBlank(this.screenId, false);
    await this.deps.push(this.screenId);
    this.snapshot = { blanked: wasBlanked };
    this.stopWatch();
    this.startRevertTimer();
  }

  private startRevertTimer(): void {
    // Only reachable from a push that switched the screen, so a stale timer
    // (screen was reset by hand in the meantime) is simply replaced.
    if (this.revertTimer) clearTimeout(this.revertTimer);
    this.revertTimer = setTimeout(() => {
      this.revertTimer = null;
      void this.revertIfStillWelcome("timer");
    }, this.welcomeDurationSeconds * 1000);
    this.revertTimer.unref?.();
  }

  /** Put the screen back to the snapshot. Caller guarantees the welcome screen is assigned. */
  private async revertNow(reason: RevertReason, state: ScreenState): Promise<void> {
    // Restore Stop if it was on when we started, or the operator pressed it
    // while the welcome screen was up (persisted, so we can still see it).
    const reblank = (this.snapshot?.blanked ?? false) || state.blanked;
    this.snapshot = null;
    this.stopWatch();

    await this.deps.setExperience(this.screenId, null);
    await this.deps.push(this.screenId);
    if (reblank) await this.deps.setBlank(this.screenId, true);

    const suffix = reblank ? " (screen re-blanked)" : "";
    console.info(
      reason === "startup"
        ? "[greeting] reverted stale welcome-screen on startup"
        : reason === "whiteboard-ended"
          ? `[greeting] whiteboard ended — reverted welcome${suffix}`
          : `[greeting] welcome-screen reverted to default media after ${this.welcomeDurationSeconds}s${suffix}`
    );
  }

  private revertIfStillWelcome(reason: "timer" | "startup"): Promise<boolean> {
    return this.run("welcome-screen revert", false, async () => {
      const welcomeId = await this.deps.getWelcomeExperienceId();
      const state = await this.deps.getState(this.screenId);
      if (!state || !this.isOnWelcome(state, welcomeId)) {
        // Something else was assigned: the welcome screen is over and must never
        // come back, so there is nothing to revert, re-blank or remember.
        this.snapshot = null;
        this.stopWatch();
        if (reason === "timer") console.info("[greeting] welcome-screen no longer showing — revert skipped");
        return false;
      }

      // Never erase an operator's whiteboard: a push stops it. The timed revert
      // stands down; a watch restores the screen the moment the whiteboard ends
      // (if the welcome screen is still assigned underneath). Startup is exempt —
      // the boot reset that follows clears whiteboards anyway.
      if (reason === "timer" && (state.whiteboardActive || this.deps.isWhiteboardDocLive(this.screenId))) {
        console.info("[greeting] revert skipped (whiteboard live)");
        this.startWatch();
        return false;
      }

      await this.revertNow(reason, state);
      return true;
    });
  }

  // ─── Whiteboard watch ───────────────────────────────────────────────────────

  private startWatch(): void {
    this.stopWatch();
    const startedAt = Date.now();
    const schedule = () => {
      this.watchTimer = setTimeout(async () => {
        this.watchTimer = null;
        if (await this.watchStep(startedAt)) schedule();
      }, WHITEBOARD_WATCH_INTERVAL_MS);
      this.watchTimer.unref?.();
    };
    schedule();
  }

  private stopWatch(): void {
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = null;
  }

  /** One check. Resolves true to keep watching. */
  private watchStep(startedAt: number): Promise<boolean> {
    return this.run("whiteboard watch", false, async () => {
      const welcomeId = await this.deps.getWelcomeExperienceId();
      const state = await this.deps.getState(this.screenId);
      if (!state || !this.isOnWelcome(state, welcomeId)) {
        this.snapshot = null; // something else took over: leave the screen alone, for good
        return false;
      }
      if (state.whiteboardActive || this.deps.isWhiteboardDocLive(this.screenId)) {
        if (Date.now() - startedAt >= WHITEBOARD_WATCH_MAX_MS) {
          console.info("[greeting] whiteboard watch gave up — welcome screen left to the operator");
          return false;
        }
        return true;
      }
      // The whiteboard is over and the welcome screen is still assigned underneath.
      await this.revertNow("whiteboard-ended", state);
      return false;
    });
  }

  // ─── Public ─────────────────────────────────────────────────────────────────

  /**
   * Startup clean-up: a welcome screen left over from a previous run. A fresh
   * process doesn't know whether that welcome screen started from a blanked
   * screen, so this goes to plain idle (the API's boot reset also clears every
   * screen's blank state, welcome or not).
   */
  revertStaleWelcomeOnStartup(): Promise<boolean> {
    return this.revertIfStillWelcome("startup");
  }

  /** Is a real player connected to the screen? (Used by the status endpoint.) */
  isOnline(): boolean {
    return this.deps.isOnline(this.screenId);
  }

  /** Deliver one flushed greeting batch to the screen. */
  present(request: GreetingRequest): Promise<void> {
    return this.run<void>("greeting presentation", undefined, async () => {
      const welcomeId = await this.deps.getWelcomeExperienceId();
      const state = await this.deps.getState(this.screenId);
      const screen = this.classify(state, welcomeId);

      if (screen.kind === "offline") {
        await request.onOffline(); // nobody to show it to: nothing shown, said or recorded
        return;
      }
      if (screen.kind === "busy") {
        await request.onBusy(screen.reason); // not our screen to take
        return;
      }

      const batch = await request.admit();
      if (!batch) return; // everyone in it was already greeted today: don't touch the screen

      if (screen.kind === "idle") {
        if (!welcomeId) {
          // Nothing to show, so nothing to say either.
          console.warn(
            "[greeting] welcome-screen experience not found — run db:seed-welcome; skipped (counted as greeted)"
          );
          return;
        }
        await this.switchToWelcome(welcomeId, screen.blanked);
      }
      // Just pushed, or already showing: the voice goes with the welcome screen.
      if (batch.voiceText) this.voice.speak(batch.voiceText);
    });
  }

  /** Test / shutdown hook. */
  cancelTimer(): void {
    if (this.revertTimer) clearTimeout(this.revertTimer);
    this.revertTimer = null;
    this.stopWatch();
  }
}
