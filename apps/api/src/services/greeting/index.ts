import {
  countGreetingsForDay,
  getAppSetting,
  getExperienceIdBySlug,
  getScreenGreetingState,
  getVisitorByUuid,
  isVisitorInRoom,
  pruneVisitorGreetings,
  recordGreeting,
  recordSkippedGreeting,
  setAppSetting,
  setScreenBlanked,
  setScreenExperience,
} from "@platform/db";
import { getLastGreetAck, type RecordedGreetAck } from "../../lib/greet-ack.js";
import { pushScreenContent } from "../../routes/screens.js";
import { getActiveWhiteboardDocuments, getConnectedScreenIds, sendCommandToScreen, setScreenBlankState } from "../../ws/gateway.js";
import { isVisionTriggerArmed, setVisionTriggerArmed } from "../door-screen-trigger.js";
import { MAIN_SCREEN_ID, WELCOME_EXPERIENCE_SLUG, getGreetingConfig } from "./config.js";
import { ScreenController } from "./screen.js";
import { GreetingService, type ServiceStatus } from "./service.js";
import { dayKey } from "./text.js";
import { createGreetingVoice } from "./voice.js";

/**
 * Production wiring for the greeting feature: real DB queries, the real
 * gateway and the configured voice. Callers (routes/internal.ts, routes/
 * visitors.ts, routes/vision-trigger.ts, routes/greeting.ts, index.ts) use the
 * functions below; the rules live in service.ts and the screen decisions in
 * screen.ts. This module is only ever import()ed when GREETING_ENABLED is on.
 *
 * State (batches, revert timer, "greeted today" cache) is in memory, so it is
 * per API process.
 */

interface Wiring {
  service: GreetingService;
  screen: ScreenController;
}

let wiring: Wiring | null = null;

function getWiring(): Wiring {
  if (wiring) return wiring;
  const config = getGreetingConfig();

  const voice = createGreetingVoice(config.voice, MAIN_SCREEN_ID, sendCommandToScreen, config.voiceName);
  // The controller reports its failures to the service's breaker, which is built
  // right after (it needs the controller to present batches).
  let service!: GreetingService;
  const screen = new ScreenController(
    {
      getState: getScreenGreetingState,
      // A saved whiteboard being pushed from the CMS (in memory); a drawn one is on the screen row.
      isWhiteboardDocLive: (id) => getActiveWhiteboardDocuments()[id] !== undefined,
      // At least one real (non-preview) player is connected.
      isOnline: (id) => getConnectedScreenIds().includes(id),
      getWelcomeExperienceId: () => getExperienceIdBySlug(WELCOME_EXPERIENCE_SLUG),
      setExperience: setScreenExperience,
      // Exactly what POST /api/screens/:id/blank does: persist, then push live.
      setBlank: async (id, blanked) => {
        await setScreenBlanked(id, blanked);
        setScreenBlankState(id, blanked);
      },
      push: pushScreenContent,
    },
    voice,
    config.welcomeDurationSeconds,
    MAIN_SCREEN_ID,
    (label, err) => service.reportScreenError(label, err)
  );
  service = new GreetingService({
    config,
    now: () => new Date(),
    getVisitor: async (uuid) => {
      const row = await getVisitorByUuid(uuid);
      return row ? { name: row.name, firstSeen: row.firstSeen } : null;
    },
    isInRoom: (uuid, windowSeconds) => isVisitorInRoom(uuid, windowSeconds ?? config.presenceWindowSeconds),
    recordGreeting,
    recordSkipped: recordSkippedGreeting,
    present: (request) => screen.present(request),
  });

  console.info(
    `[greeting] enabled — tz=${config.timezone} voice=${config.voice}${config.voiceName ? `("${config.voiceName}")` : ""} ` +
      `unknown=${config.greetUnknown} names=${config.nameMode} batch=${config.batchWindowMs}ms ` +
      `welcome=${config.welcomeDurationSeconds}s fresh=${config.arrivalFreshSeconds}s ` +
      `welcomeVideo=${config.welcomeVideoMuted === null ? "as-authored" : config.welcomeVideoMuted ? "muted" : "unmuted"} ` +
      `busySkipsDay=${config.busySkipsDay} retention=${config.retentionDays}d`
  );
  wiring = { service, screen };
  return wiring;
}

/** VISITOR_DETECTED -> arrival greeting. */
export function onVisitorDetected(uuid: string, opts: { eventLastSeen?: string } = {}): Promise<void> {
  return getWiring().service.onVisitorDetected(uuid, opts);
}

/** Drop the "greeted today" cache entry (name changed while greetings were off/disarmed). */
export function invalidateVisitor(uuid: string): void {
  getWiring().service.invalidate(uuid);
}

/** A blank name became non-blank (checked by the caller). */
export function onVisitorRenamed(uuid: string): Promise<void> {
  return getWiring().service.onVisitorRenamed(uuid);
}

/** After mergeVisitor commits: the surviving (target) visitor. */
export function onVisitorMerged(targetUuid: string): Promise<void> {
  return getWiring().service.onVisitorMerged(targetUuid);
}

/** API startup: the welcome screen is always transient, so clear a stale one. */
export function revertStaleWelcomeOnStartup(): Promise<boolean> {
  return getWiring().screen.revertStaleWelcomeOnStartup();
}

// ─── Persisted arm switch ─────────────────────────────────────────────────────

/** app_setting key for the welcome-trigger arm switch ("true" | "false"). */
export const ARM_SETTING_KEY = "vision_trigger_armed";

/**
 * Boot: restore the operator's arm/disarm choice. No row yet -> stays armed (the
 * default). If the setting can't be read, start DISARMED rather than silently
 * greeting people while we don't know what the operator chose. Never throws.
 */
export async function restoreArmedState(): Promise<void> {
  try {
    const stored = await getAppSetting(ARM_SETTING_KEY);
    if (stored !== null) {
      setVisionTriggerArmed(stored === "true");
      console.info(`[greeting] arm switch restored: ${stored === "true" ? "armed" : "DISARMED"}`);
    }
  } catch (err) {
    setVisionTriggerArmed(false);
    console.error(
      "[greeting] could not read the arm setting (is migration 0041 applied?) — starting DISARMED:",
      err instanceof Error ? err.message : err
    );
  }
}

/** Persist the arm switch. Never throws (the in-memory switch has already changed). */
export async function persistArmedState(armed: boolean): Promise<void> {
  try {
    await setAppSetting(ARM_SETTING_KEY, String(armed));
  } catch (err) {
    console.error("[greeting] could not persist the arm switch — it will reset on restart:", err instanceof Error ? err.message : err);
  }
}

// ─── Retention ────────────────────────────────────────────────────────────────

const PRUNE_CHECK_MS = 60 * 60_000;
const PRUNE_EVERY_MS = 24 * 60 * 60_000;
let lastPrunedAt = 0;

/** Delete visitor_greeting rows older than GREETING_RETENTION_DAYS. Returns how many went; never throws. */
export async function pruneOldGreetings(now: Date = new Date()): Promise<number> {
  const config = getGreetingConfig();
  try {
    const cutoff = dayKey(new Date(now.getTime() - config.retentionDays * 86_400_000), config.timezone);
    const removed = await pruneVisitorGreetings(cutoff);
    lastPrunedAt = now.getTime();
    if (removed > 0) console.info(`[greeting] pruned ${removed} visitor_greeting row(s) older than ${config.retentionDays} days`);
    return removed;
  } catch (err) {
    console.error("[greeting] retention purge failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Hourly check, one purge per day. Only started while greetings are enabled. */
export function startRetentionPurge(): void {
  const tick = () => {
    if (Date.now() - lastPrunedAt >= PRUNE_EVERY_MS) void pruneOldGreetings();
  };
  setTimeout(tick, 60_000).unref?.(); // first one a minute after boot, not during it
  setInterval(tick, PRUNE_CHECK_MS).unref?.();
}

// ─── Status ───────────────────────────────────────────────────────────────────

export interface GreetingStatus {
  enabled: true;
  armed: boolean;
  voice: string;
  voiceName: string | null;
  nameMode: string;
  unknownMode: string;
  busySkipsDay: string;
  timezone: string;
  welcomeVideoMuted: boolean | null;
  screen: { id: string; online: boolean };
  /** Durable: counted from visitor_greeting for today's local day. */
  today: {
    date: string;
    greeted: number;
    generic: number;
    named: number;
    skipped: number;
    skippedByReason: Record<string, number>;
  };
  /** In memory: reset by an API restart. */
  lastGreeting: ServiceStatus["lastGreeting"];
  counters: ServiceStatus["counters"];
  breaker: ServiceStatus["breaker"];
  /** What the TV last said about a spoken greeting (works even though the kiosk has no devtools). */
  lastTvAck: RecordedGreetAck | null;
}

export async function getGreetingStatus(): Promise<GreetingStatus> {
  const { service, screen } = getWiring();
  const config = getGreetingConfig();
  const date = dayKey(new Date(), config.timezone);

  const today: GreetingStatus["today"] = { date, greeted: 0, generic: 0, named: 0, skipped: 0, skippedByReason: {} };
  try {
    for (const row of await countGreetingsForDay(date)) {
      if (row.kind === "skipped") {
        today.skipped += row.count;
        const reason = row.skipReason ?? "unspecified";
        today.skippedByReason[reason] = (today.skippedByReason[reason] ?? 0) + row.count;
      } else {
        today.greeted += row.count;
        today[row.kind] += row.count;
      }
    }
  } catch (err) {
    console.error("[greeting] status: could not count today's greetings:", err instanceof Error ? err.message : err);
  }

  const memory = service.status();
  return {
    enabled: true,
    armed: isVisionTriggerArmed(),
    voice: config.voice,
    voiceName: config.voiceName,
    nameMode: config.nameMode,
    unknownMode: config.greetUnknown,
    busySkipsDay: config.busySkipsDay,
    timezone: config.timezone,
    welcomeVideoMuted: config.welcomeVideoMuted,
    screen: { id: MAIN_SCREEN_ID, online: screen.isOnline() },
    today,
    lastGreeting: memory.lastGreeting,
    counters: memory.counters,
    breaker: memory.breaker,
    lastTvAck: getLastGreetAck(),
  };
}
