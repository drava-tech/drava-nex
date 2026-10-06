import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { recordVoiceCommand } from "@platform/db";
import { ok, fail } from "../lib/response.js";
import { secretsMatch, sourceIp, RateLimiter, logAuthFailure, logRateLimited } from "../lib/internal-auth.js";
import {
  listVoiceDevices,
  listVoiceScreens,
  listVoiceExperiences,
  listVoiceMedia,
  runDeviceCommand,
  runScreenCommand,
  VoiceActionError,
} from "../services/voice-actions.js";

/**
 * Internal voice-command relay for TRAVIS's room-mic voice engine (a headless
 * Python process, no browser/user session — see docs/CMS_OVERVIEW_AND_AI_INTEGRATION.md
 * and the TRAVIS repo's actions/device_control.py + actions/screen_control.py).
 * Guarded by a shared secret, same pattern as routes/internal.ts's vision-event
 * relay, but voice gets its own separately-revocable secret since it's a
 * distinct actor class that can also push CMS content, not just report events.
 *
 * TRAVIS is treated as admin-equivalent (it's the only way to reach these
 * routes at all), scoped down by the optional allow-lists below — since this
 * surface has no per-user login, the allow-list is the only thing standing
 * between "anyone near the room mic" and "any screen/device in the building".
 */
export const voiceInternalRouter = new Hono();

function checkSecret(c: Context): boolean {
  return secretsMatch(c.req.header("x-voice-secret"), process.env["VOICE_AGENT_SECRET"]);
}

/**
 * Scope allow-lists, checked against a RESOLVED device id / screenId — not
 * the raw spoken target string. They used to be checked against the caller's
 * free-text `target`/`screen` field before name resolution ever ran, which
 * meant populating them with real device/screen ids could never match
 * anything (a spoken phrase never equals a stored id) — the allow-list was
 * silently unenforceable no matter what you put in it. Checking post-
 * resolution, inside runDeviceCommand/runScreenCommand, fixes that: it's the
 * first point where a stable id actually exists.
 */
function allowList(envVar: string): Set<string> | null {
  const raw = process.env[envVar];
  if (!raw) return null; // unset = no restriction (single-room deployments)
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

// One shared budget across every route in this router: this surface exists
// for exactly one always-on room-mic caller, so legitimate traffic is a
// handful of requests per spoken command, never a burst. Generous enough to
// never throttle real use, tight enough that a brute-force/probing script
// hits a wall fast instead of hammering the secret check indefinitely.
const rateLimiter = new RateLimiter(120, 60_000);

voiceInternalRouter.use("*", async (c, next) => {
  const ip = sourceIp(c);
  if (!rateLimiter.check(ip)) {
    logRateLimited("voice-internal", c);
    return fail(c, "RATE_LIMITED", "Too many requests.", 429);
  }
  if (!checkSecret(c)) {
    logAuthFailure("voice-internal", c);
    return fail(c, "UNAUTHORIZED", "Unauthorized", 401);
  }
  return next();
});

function handleVoiceError(c: Context, err: unknown) {
  if (err instanceof VoiceActionError) {
    const status = err.code === "FORBIDDEN" || err.code === "FORBIDDEN_SCOPE" ? 403 : 400;
    return fail(c, err.code, err.message, status);
  }
  // Travis reads this message aloud: say what failed, never the vendor's error
  // text or code (e.g. Tuya's "IoT Core service subscription has expired (code
  // 28841002)"). The full error stays in the server log and the audit trail.
  console.error("[voice-internal] unhandled error:", err);
  return fail(c, "INTERNAL", "That didn't go through. The device isn't responding.", 500);
}

function errorMessage(err: unknown): string {
  return err instanceof VoiceActionError || err instanceof Error ? err.message : "Something went wrong.";
}

/** The structured VoiceActionError code, or a generic fallback — lets the
 *  audit log be filtered by failure category instead of message text. */
function errorCode(err: unknown): string {
  return err instanceof VoiceActionError ? err.code : "INTERNAL";
}

/** Per-conversation grouping, sent by the voice agent as x-session-id (one
 *  value per Gemini Live connection — see services/voice-agent/main.py). Not
 *  present for any other caller of this API, so it's simply absent there. */
function sessionId(c: Context): string | null {
  return c.req.header("x-session-id") ?? null;
}

/**
 * Dedup for retried commands. The Python client (actions/cms_client.py) now
 * retries a device/screen command once on a network-level failure (timeout,
 * connection reset) — but a network failure can happen AFTER apps/api already
 * carried out the action and was just unable to get the response back, so a
 * naive retry risks double-actuating (e.g. sending "lock" twice). The client
 * resends the same x-idempotency-key on a retry; if that key already produced
 * a successful result recently, we replay that result instead of re-running
 * the action. Failures are deliberately NOT cached — a failed attempt should
 * be free to actually retry (the whole point of retrying), since whatever
 * caused it (MQTT blip, HA hiccup) may have cleared by the second attempt.
 */
const IDEMPOTENCY_TTL_MS = 30_000;
const idempotencyStore = new Map<string, { at: number; response: unknown }>();

function pruneIdempotencyStore(): void {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
  for (const [key, entry] of idempotencyStore) {
    if (entry.at < cutoff) idempotencyStore.delete(key);
  }
}

function getIdempotentReplay(key: string | undefined): unknown | undefined {
  if (!key) return undefined;
  pruneIdempotencyStore();
  return idempotencyStore.get(key)?.response;
}

function rememberIdempotentSuccess(key: string | undefined, response: unknown): void {
  if (!key) return;
  idempotencyStore.set(key, { at: Date.now(), response });
}

/**
 * Every command TRAVIS issues gets one row here — success or failure — so
 * there's a persistent record of what was done and when, distinct from the
 * CMS's own button-driven actions (which never write here). Fire-and-forget:
 * a logging failure must never turn a real action's response into an error.
 */
function logVoiceCommand(entry: {
  tool: "device_control" | "screen_control";
  action: string;
  target?: string | null;
  content?: string | null;
  params?: Record<string, unknown> | null;
  success: boolean;
  message: string;
  code?: string | null;
  sessionId?: string | null;
  wasReplay?: boolean;
}): void {
  recordVoiceCommand(entry).catch((err) => console.error("[voice-internal] failed to log voice command:", err));
}

// --- Reads, for name resolution + status questions ---

voiceInternalRouter.get("/devices", async (c) =>
  ok(c, await listVoiceDevices(allowList("VOICE_AGENT_ALLOWED_DEVICE_IDS")))
);
voiceInternalRouter.get("/screens", async (c) => ok(c, await listVoiceScreens()));
voiceInternalRouter.get("/experiences", async (c) => ok(c, await listVoiceExperiences()));
voiceInternalRouter.get("/media", async (c) => ok(c, await listVoiceMedia()));

// --- Device control ---

const deviceCommandSchema = z.object({
  action: z.enum([
    "lights_on",
    "lights_off",
    "lights_set",
    "scene_recall",
    "ac_command",
    "lock",
    "unlock",
    "status",
    "good_night",
    "good_morning",
    "ambient_mode",
    "all_lights_on",
    "all_lights_off",
  ]),
  target: z.string().min(1).optional(),
  brightness: z.number().min(0).max(100).optional(),
  color: z.string().optional(),
  command: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  meshScene: z.number().int().min(1).max(255).optional(),
  meshLevel: z.number().int().min(0).max(255).optional(),
});

/**
 * Consolidates every command-specific field onto one object for logging.
 * `params` alone isn't enough: brightness/color/command/meshScene/meshLevel
 * are separate top-level request fields, not nested inside `params` — this
 * is the only place their actual values get captured, since the spoken
 * result message doesn't always restate them (an ac_command reply never
 * repeats the temperature it set, for example).
 */
function deviceCommandLogParams(body: z.infer<typeof deviceCommandSchema>): Record<string, unknown> | null {
  const merged = {
    ...(body.params ?? {}),
    ...(body.brightness !== undefined ? { brightness: body.brightness } : {}),
    ...(body.color !== undefined ? { color: body.color } : {}),
    ...(body.command !== undefined ? { command: body.command } : {}),
    ...(body.meshScene !== undefined ? { meshScene: body.meshScene } : {}),
    ...(body.meshLevel !== undefined ? { meshLevel: body.meshLevel } : {}),
  };
  return Object.keys(merged).length > 0 ? merged : null;
}

voiceInternalRouter.post("/device-command", async (c) => {
  let body: z.infer<typeof deviceCommandSchema>;
  try {
    body = deviceCommandSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  const idempotencyKey = c.req.header("x-idempotency-key");
  const session = sessionId(c);
  const replay = getIdempotentReplay(idempotencyKey);
  if (replay !== undefined) {
    const r = replay as { message: string; resolvedTarget?: string };
    logVoiceCommand({
      tool: "device_control",
      action: body.action,
      target: r.resolvedTarget ?? body.target ?? null,
      params: deviceCommandLogParams(body),
      success: true,
      message: r.message,
      code: "OK",
      sessionId: session,
      wasReplay: true,
    });
    return ok(c, replay);
  }
  try {
    const result = await runDeviceCommand(body, "ADMIN", allowList("VOICE_AGENT_ALLOWED_DEVICE_IDS"));
    logVoiceCommand({
      tool: "device_control",
      action: body.action,
      // Prefer the resolved device's real name over the raw spoken phrase
      // ("relax scene" -> "Relax") so the log reads clearly on its own.
      target: result.resolvedTarget ?? body.target ?? null,
      params: deviceCommandLogParams(body),
      success: true,
      message: result.message,
      code: "OK",
      sessionId: session,
    });
    rememberIdempotentSuccess(idempotencyKey, result);
    return ok(c, result);
  } catch (err) {
    logVoiceCommand({
      tool: "device_control",
      action: body.action,
      target: body.target ?? null,
      params: deviceCommandLogParams(body),
      success: false,
      message: errorMessage(err),
      code: errorCode(err),
      sessionId: session,
    });
    return handleVoiceError(c, err);
  }
});

// --- Screen / content control ---

const screenCommandSchema = z.object({
  action: z.enum([
    "assign_experience",
    "assign_media",
    "idle",
    "stop",
    "status",
    "play",
    "pause",
    "seek_forward",
    "seek_back",
    "next_item",
    "previous_item",
    "reset_view",
  ]),
  screen: z.string().min(1),
  content: z.string().min(1).optional(),
});

voiceInternalRouter.post("/screen-command", async (c) => {
  let body: z.infer<typeof screenCommandSchema>;
  try {
    body = screenCommandSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  const idempotencyKey = c.req.header("x-idempotency-key");
  const session = sessionId(c);
  const replay = getIdempotentReplay(idempotencyKey);
  if (replay !== undefined) {
    const r = replay as { message: string; resolvedTarget?: string; resolvedContent?: string };
    logVoiceCommand({
      tool: "screen_control",
      action: body.action,
      target: r.resolvedTarget ?? body.screen,
      content: r.resolvedContent ?? body.content ?? null,
      success: true,
      message: r.message,
      code: "OK",
      sessionId: session,
      wasReplay: true,
    });
    return ok(c, replay);
  }
  try {
    // Screen room-mic actions are treated as guest-level — the same bar the
    // CMS itself sets for screen/content pushes (requireGuestOrAdmin).
    const result = await runScreenCommand(body, "GUEST", allowList("VOICE_AGENT_ALLOWED_SCREEN_IDS"));
    rememberIdempotentSuccess(idempotencyKey, result);
    logVoiceCommand({
      tool: "screen_control",
      action: body.action,
      // Prefer the resolved screen/content names over the raw spoken phrase
      // so the log reads clearly on its own (e.g. "Relax" not "relax scene").
      target: result.resolvedTarget ?? body.screen,
      content: result.resolvedContent ?? body.content ?? null,
      success: true,
      message: result.message,
      code: "OK",
      sessionId: session,
    });
    return ok(c, result);
  } catch (err) {
    logVoiceCommand({
      tool: "screen_control",
      action: body.action,
      target: body.screen,
      content: body.content ?? null,
      success: false,
      message: errorMessage(err),
      code: errorCode(err),
      sessionId: session,
    });
    return handleVoiceError(c, err);
  }
});
