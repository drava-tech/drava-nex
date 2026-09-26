import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { MQTTDeviceManager } from "@platform/iot";
import { ok, fail } from "../lib/response.js";
import {
  AC_MODES,
  VoiceControlError,
  controlAc,
  controlDoor,
  controlLights,
  controlScreen,
  controlVolume,
  listVoiceControlNames,
  pushContent,
  type VoiceControlResult,
  controlAmbientMode,
} from "../services/voice-control.js";

/**
 * /api/voice-control — the machine-to-machine API for services/voice-control
 * (rule-based TRAVIS: Vosk + command registry, no LLM). No user session: the
 * caller proves itself with its own shared secret, header
 * x-travis-vc-key = TRAVIS_VC_KEY, separate from every other
 * secret so it can be rotated or revoked on its own. Unset = route disabled.
 *
 * Routes take names as spoken; services/voice-control.ts resolves them and
 * runs the same code paths as the CMS's buttons.
 */

function secretMatches(provided: string | undefined): boolean {
  const expected = process.env["TRAVIS_VC_KEY"];
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Constant-time compare so response timing can't leak a guessed prefix.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Fixed-window limiter: a room mic sends a few requests per spoken command, never a burst. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
let windowStart = 0;
let windowCount = 0;

function withinRateLimit(): boolean {
  const now = Date.now();
  if (now - windowStart >= RATE_WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount++;
  return windowCount <= RATE_LIMIT;
}

/**
 * The client retries once on a network failure with the same
 * x-idempotency-key; if the first attempt already succeeded (only the
 * response was lost), replay its result instead of actuating twice
 * ("unlock" sent twice, or two volume steps instead of one).
 */
const REPLAY_TTL_MS = 30_000;
const replays = new Map<string, { at: number; result: VoiceControlResult }>();

function replayFor(key: string | undefined): VoiceControlResult | undefined {
  const now = Date.now();
  for (const [k, v] of replays) if (now - v.at > REPLAY_TTL_MS) replays.delete(k);
  return key ? replays.get(key)?.result : undefined;
}

const schemas = {
  lights: z.object({
    action: z.enum(["on", "off", "set"]),
    target: z.string().min(1).optional(),
    brightness: z.number().int().min(0).max(100).optional(),
    color: z.string().min(1).optional(),
  }),
  ac: z.object({
    action: z.enum(["power_on", "power_off", "set_temp", "set_mode"]),
    temp: z.number().int().min(16).max(30).optional(),
    mode: z.enum(AC_MODES).optional(),
    target: z.string().min(1).optional(),
  }),
  volume: z.object({
    action: z.enum(["up", "down", "mute"]),
    times: z.number().int().min(1).max(10).optional(),
  }),
  door: z.object({ action: z.enum(["lock", "unlock"]) }),
  screen: z.object({ action: z.enum(["play", "pause", "stop"]), screen: z.string().min(1) }),
  content: z.object({
    kind: z.enum(["experience", "media", "any"]).default("any"),
    content: z.string().min(1),
    screen: z.string().min(1),
  }),
  ambientMode: z.object({
  mode: z.string().min(1),
  }),

};

export function createVoiceControlRouter(mqtt: MQTTDeviceManager): Hono {
  const router = new Hono();

  router.use("*", async (c, next) => {
    if (!withinRateLimit()) return fail(c, "RATE_LIMITED", "Too many requests.", 429);
    if (!secretMatches(c.req.header("x-travis-vc-key"))) {
      console.warn(`[voice-control] rejected unauthenticated ${c.req.method} ${c.req.path}`);
      return fail(c, "UNAUTHORIZED", "Unauthorized", 401);
    }
    return next();
  });

  /** Validate, replay-or-run, log one line, map errors to the API envelope. */
  function command<S extends z.ZodTypeAny>(path: string, schema: S, run: (body: z.infer<S>) => Promise<VoiceControlResult>) {
    router.post(path, async (c: Context) => {
      let body: z.infer<S>;
      try {
        body = schema.parse(await c.req.json());
      } catch (err) {
        return fail(c, "VALIDATION", "Invalid request body", 400, err instanceof z.ZodError ? err.issues : undefined);
      }
      const key = c.req.header("x-idempotency-key");
      const replay = replayFor(key);
      if (replay) return ok(c, replay);
      try {
        const result = await run(body);
        if (key) replays.set(key, { at: Date.now(), result });
        console.info(`[voice-control] ${path} ${JSON.stringify(body)} -> ${result.message}`);
        return ok(c, result);
      } catch (err) {
        if (err instanceof VoiceControlError) {
          console.info(`[voice-control] ${path} ${JSON.stringify(body)} -> ${err.code}: ${err.message}`);
          return fail(c, err.code, err.message, err.status);
        }
        console.error(`[voice-control] ${path} failed:`, err);
        return fail(c, "INTERNAL", "Something went wrong.", 500);
      }
    });
  }

  command("/lights", schemas.lights, controlLights);
  command("/ac", schemas.ac, controlAc);
  command("/ambient-mode", schemas.ambientMode, controlAmbientMode);
  command("/volume", schemas.volume, controlVolume);
  command("/door", schemas.door, (b) => controlDoor(mqtt, b.action));
  command("/screen", schemas.screen, controlScreen);
  command("/content", schemas.content, pushContent);

  // Every name voice control can act on — for setup/debugging only.
  router.get("/names", async (c) => ok(c, await listVoiceControlNames()));

  return router;
}
