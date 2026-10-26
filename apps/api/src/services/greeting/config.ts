import { isGreetingEnabled } from "../../lib/greeting-flag.js";
import { welcomeVideoMuted } from "../../lib/welcome-policy.js";
import type { NameMode } from "./text.js";

/**
 * Greeting-on-arrival configuration. Everything is env-driven (documented in
 * .env.example); parsing is defensive — a bad value falls back to its default
 * with a warning rather than stopping the API.
 */

export const MAIN_SCREEN_ID = "main-screen";
export const WELCOME_EXPERIENCE_SLUG = "welcome-screen";

export type GreetUnknownMode = "screen" | "generic" | "off";
export type GreetingVoiceKind = "screen" | "off" | "travis";
export type BusySkipsDay = "all" | "whiteboard";

export interface GreetingConfig {
  /** Master switch, default OFF (see lib/greeting-flag.ts). Off = nothing here runs. */
  enabled: boolean;
  /** IANA timezone that defines "today" and the part of day. */
  timezone: string;
  greetUnknown: GreetUnknownMode;
  voice: GreetingVoiceKind;
  /** Visitor counts as "in the room" if last_seen is this recent. */
  presenceWindowSeconds: number;
  afternoonHour: number;
  eveningHour: number;
  /** 0 disables grouping. */
  batchWindowMs: number;
  maxNames: number;
  welcomeDurationSeconds: number;
  /**
   * Which busy-screen reasons write a 'skipped' row that blocks the visitor's greetings for
   * the rest of the day: 'all' (whiteboard, blanked over content, other content) or only 'whiteboard'.
   * For the others the visitor counts as greeted, silently.
   */
  busySkipsDay: BusySkipsDay;
  /** How visitors are named aloud: full name as entered, first word only, or never. */
  nameMode: NameMode;
  /** Pin a speechSynthesis voice on the TV by name (optional; falls back to en-IN, then any English). */
  voiceName: string | null;
  /**
   * An arrival is only greeted if the sighting is this fresh: the event's own timestamp must be
   * no older than this, and the visitor's last_seen (DB clock) no older than this plus the vision
   * service's 30 s write cooldown. Stops a replayed/old event greeting someone who has left.
   */
  arrivalFreshSeconds: number;
  /** visitor_greeting rows older than this many days are purged daily (only while greetings are on). */
  retentionDays: number;
  /** Effective WELCOME_VIDEO_MUTED: true/false, or null = leave the video as authored. */
  welcomeVideoMuted: boolean | null;
}

type Env = Record<string, string | undefined>;

function int(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    console.warn(`[greeting] ${key}="${raw}" must be an integer in ${min}..${max} — using ${fallback}`);
    return fallback;
  }
  return n;
}

function oneOf<T extends string>(env: Env, key: string, allowed: readonly T[], fallback: T): T {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  console.warn(`[greeting] ${key}="${raw}" must be one of ${allowed.join("|")} — using ${fallback}`);
  return fallback;
}

export const DEFAULT_GREETING_TZ = "Asia/Kolkata";

function timezone(env: Env): string {
  const raw = env["GREETING_TZ"]?.trim();
  if (!raw) return DEFAULT_GREETING_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    console.warn(`[greeting] GREETING_TZ="${raw}" is not a valid IANA timezone — using ${DEFAULT_GREETING_TZ}`);
    return DEFAULT_GREETING_TZ;
  }
}

export function loadGreetingConfig(env: Env = process.env): GreetingConfig {
  let afternoonHour = int(env, "GREET_AFTERNOON_HOUR", 12, 0, 23);
  let eveningHour = int(env, "GREET_EVENING_HOUR", 17, 1, 24);
  if (eveningHour <= afternoonHour) {
    console.warn("[greeting] GREET_EVENING_HOUR must be after GREET_AFTERNOON_HOUR — using 12/17");
    afternoonHour = 12;
    eveningHour = 17;
  }

  return {
    enabled: isGreetingEnabled(env),
    timezone: timezone(env),
    greetUnknown: oneOf(env, "GREET_UNKNOWN", ["screen", "generic", "off"], "screen"),
    voice: oneOf(env, "GREETING_VOICE", ["screen", "off", "travis"], "screen"),
    presenceWindowSeconds: int(env, "GREET_PRESENCE_WINDOW_SECONDS", 120, 1, 86_400),
    afternoonHour,
    eveningHour,
    batchWindowMs: int(env, "GREET_BATCH_WINDOW_MS", 3000, 0, 60_000),
    maxNames: int(env, "GREET_MAX_NAMES", 4, 1, 20),
    welcomeDurationSeconds: int(env, "WELCOME_SCREEN_DURATION_SECONDS", 20, 1, 3600),
    welcomeVideoMuted: welcomeVideoMuted(env),
    busySkipsDay: oneOf(env, "GREET_BUSY_SKIPS_DAY", ["all", "whiteboard"], "all"),
    nameMode: oneOf(env, "GREET_NAME_MODE", ["full", "first", "none"], "full"),
    voiceName: env["GREETING_VOICE_NAME"]?.trim().slice(0, 100) || null,
    arrivalFreshSeconds: int(env, "GREET_ARRIVAL_FRESH_SECONDS", 30, 1, 600),
    retentionDays: int(env, "GREETING_RETENTION_DAYS", 30, 1, 3650),
  };
}

let cached: GreetingConfig | null = null;

/** Process-wide config, read once on first use. */
export function getGreetingConfig(): GreetingConfig {
  cached ??= loadGreetingConfig();
  return cached;
}

