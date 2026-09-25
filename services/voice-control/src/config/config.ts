import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Settings live in config/voice-control.json (committed, no secrets), with
 * per-machine overrides in config/local.json (gitignored, deep-merged on
 * top). Secrets come only from the environment: services/voice-control/.env
 * first, then the repo root .env. TRAVIS_VC_KEY must equal the value
 * apps/api is started with.
 */

export const SERVICE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = resolve(SERVICE_ROOT, "..", "..");

export interface VoiceControlConfig {
  cms: { baseUrl: string; timeoutMs: number; secret: string };
  audio: {
    sampleRate: number;
    frameMs: number;
    inputDevicePreference: string[];
    outputDevicePreference: string[];
    speakerGain: number;
  };
  vad: { mode: 0 | 1 | 2 | 3; speechStartMs: number; speechEndMs: number; preRollMs: number; maxUtteranceMs: number };
  wakeWord: { word: string; decoys: string[]; minConfidence: number; acceptPartial: boolean };
  stt: { modelPath: string; minConfidence: number };
  session: {
    /** Chime right after the wake word. */
    wakeChime: boolean;
    /** "Travis" then this much silence -> Travis asks what's wanted. */
    nudgeAfterMs: number;
    /** Give up waiting for the command after "Travis" alone. */
    awakeTimeoutMs: number;
    /** How long a clarifying question ("Which screen?") stays answerable. */
    pendingAskMs: number;
  };
  matching: { fuzzy: boolean; fuzzyThreshold: number; minMatchConfidence: number };
  /** Real CMS names to use when a command names no target. null = ask. */
  defaults: { lightTarget: string | null; acTarget: string | null; screen: string | null };
  tts: { provider: "elevenlabs"; voiceId: string; modelId: string; apiKey: string };
}

type Json = Record<string, unknown>;

function deepMerge(base: Json, over: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b)
        ? deepMerge(b as Json, v as Json)
        : v;
  }
  return out;
}

function readJson(path: string): Json {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Json) : {};
}

function loadEnvFiles(): void {
  for (const file of [join(SERVICE_ROOT, ".env"), join(REPO_ROOT, ".env")]) {
    // process.loadEnvFile never overwrites variables that are already set,
    // so the service-local .env wins over the root one.
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export function loadConfig(): VoiceControlConfig {
  loadEnvFiles();
  const merged = deepMerge(
    readJson(join(SERVICE_ROOT, "config", "voice-control.json")),
    readJson(join(SERVICE_ROOT, "config", "local.json"))
  ) as unknown as VoiceControlConfig;

  merged.cms.baseUrl = (process.env["VOICE_CONTROL_CMS_URL"] ?? merged.cms.baseUrl).replace(/\/$/, "");
  merged.cms.secret = process.env["TRAVIS_VC_KEY"] ?? "";
  merged.tts.apiKey = process.env["ELEVENLABS_API_KEY"] ?? "";
  merged.tts.voiceId = process.env["ELEVENLABS_VOICE_ID"] || merged.tts.voiceId;
  merged.tts.modelId = process.env["ELEVENLABS_MODEL_ID"] || merged.tts.modelId;
  if (!isAbsolute(merged.stt.modelPath)) merged.stt.modelPath = join(SERVICE_ROOT, merged.stt.modelPath);
  return merged;
}
