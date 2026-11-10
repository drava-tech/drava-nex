import { Hono } from "hono";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import {
  createMotionTrigger,
  deleteMotionTrigger,
  getMediaAsset,
  motionTriggerExists,
  updateMotionTrigger,
  type MotionTriggerInput,
} from "@platform/db";
import { isValidTimezone, MAX_ITEM_SECONDS, MIN_ITEM_SECONDS, parseTimeOfDay } from "@platform/types";
import { requireAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { libraryVideoSeconds } from "./media.js";
import {
  currentMotionTriggers,
  fireMotionSensor,
  invalidateMotionTriggers,
  motionTriggerStatus,
  startTrigger,
} from "../services/motion-triggers.js";

// Everything under /api/motion-triggers: "when this sensor sees someone, play
// this on these screens". Admins set them up; a sensor (or anything standing
// in for one) fires them through POST /fire with the shared token, and Home
// Assistant's binary sensors fire them directly (services/motion-triggers.ts).
export const motionTriggersRouter = new Hono();

function param(c: Parameters<typeof ok>[0], name: string): string {
  return (c.req.param() as Record<string, string | undefined>)[name] ?? "";
}

const timeString = z.string().refine((v) => parseTimeOfDay(v) !== null, "Times are HH:MM (24-hour).");
const triggerSchema = z
  .object({
    name: z.string().trim().min(1, "Give the trigger a name.").max(80),
    sensorId: z.string().trim().min(1, "Pick the motion sensor.").max(200),
    screenIds: z.array(z.string().min(1)).max(500),
    groupIds: z.array(z.string().min(1)).max(500),
    mediaAssetId: z.string().min(1, "Pick an image or video to play."),
    // 0 is fine for a video: its own length is read below.
    durationSeconds: z.number().int().min(0).max(MAX_ITEM_SECONDS),
    cooldownSeconds: z.number().int().min(0).max(24 * 60 * 60),
    startTime: timeString.nullable(),
    endTime: timeString.nullable(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day.").max(7),
    timezone: z.string().refine(isValidTimezone, "Unknown timezone."),
  })
  .refine((s) => (s.startTime === null) === (s.endTime === null), {
    message: "Set both a start and an end time, or neither for any time.",
    path: ["endTime"],
  })
  .refine((s) => s.screenIds.length + s.groupIds.length > 0, { message: "Pick at least one screen or group.", path: ["screenIds"] });

async function parseTrigger(c: Parameters<typeof ok>[0]): Promise<MotionTriggerInput | Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return fail(c, "VALIDATION", "Invalid request body", 400);
  }
  const result = triggerSchema.safeParse(raw);
  if (!result.success) return fail(c, "VALIDATION", result.error.issues[0]?.message ?? "Invalid trigger", 400, result.error.issues);
  const t = { ...result.data };
  const media = await getMediaAsset(t.mediaAssetId);
  if (!media || (media.type !== "image" && media.type !== "video")) {
    return fail(c, "VALIDATION", "What plays must be an image or a video in the library.", 400);
  }
  if (media.type === "video") {
    // A video plays its full length, read from the file.
    const seconds = await libraryVideoSeconds(media);
    if (seconds) t.durationSeconds = Math.min(MAX_ITEM_SECONDS, seconds);
    else if (t.durationSeconds < MIN_ITEM_SECONDS) {
      return fail(c, "VALIDATION", `Couldn't read how long "${media.name}" is. Check the file is in this server's media library.`, 400);
    }
  } else if (t.durationSeconds < MIN_ITEM_SECONDS) {
    return fail(c, "VALIDATION", `The image needs at least ${MIN_ITEM_SECONDS} seconds on screen.`, 400);
  }
  return {
    ...t,
    daysOfWeek: [...new Set(t.daysOfWeek)].sort(),
    screenIds: [...new Set(t.screenIds)],
    groupIds: [...new Set(t.groupIds)],
  };
}

// ─── For sensors: POST /api/motion-triggers/fire { sensor } ──────────────────
// For a sensor that isn't in Home Assistant. Authorised by the shared token in
// MOTION_TRIGGER_TOKEN (header "X-Motion-Token"), not a login. Registered
// before the admin routes.
function tokenMatches(given: string | undefined): boolean {
  const expected = process.env["MOTION_TRIGGER_TOKEN"]?.trim();
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

motionTriggersRouter.post("/fire", async (c) => {
  if (!process.env["MOTION_TRIGGER_TOKEN"]?.trim()) {
    return fail(c, "DISABLED", "Sensor calls are off: set MOTION_TRIGGER_TOKEN on the API to allow them.", 403);
  }
  if (!tokenMatches(c.req.header("x-motion-token"))) return fail(c, "UNAUTHORIZED", "Wrong or missing X-Motion-Token.", 401);
  const body = await c.req.json().catch(() => null);
  const sensor = typeof body?.sensor === "string" ? body.sensor : c.req.query("sensor");
  if (!sensor?.trim()) return fail(c, "VALIDATION", "Say which sensor saw motion: { \"sensor\": \"lobby\" }.", 400);
  return ok(c, { sensor, triggers: await fireMotionSensor(sensor) });
});

// ─── For admins ──────────────────────────────────────────────────────────────

// GET /api/motion-triggers — the triggers, what each is doing, and what's set up
motionTriggersRouter.get("/", requireAdmin, async (c) => {
  invalidateMotionTriggers();
  const triggers = await currentMotionTriggers();
  return ok(c, {
    triggers,
    status: motionTriggerStatus(),
    homeAssistant: Boolean(process.env["HA_URL"] && process.env["HA_TOKEN"]),
    sensorCalls: Boolean(process.env["MOTION_TRIGGER_TOKEN"]?.trim()),
  });
});

// GET /api/motion-triggers/sensors — Home Assistant's motion/presence sensors
motionTriggersRouter.get("/sensors", requireAdmin, async (c) => {
  const url = process.env["HA_URL"];
  const token = process.env["HA_TOKEN"];
  if (!url || !token) return ok(c, { available: false, sensors: [] });
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/states`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return ok(c, { available: false, sensors: [] });
    const states = (await res.json()) as { entity_id: string; state: string; attributes?: Record<string, unknown> }[];
    const kinds = new Set(["motion", "occupancy", "presence", "moving"]);
    const sensors = states
      .filter((s) => s.entity_id.startsWith("binary_sensor.") && kinds.has(String(s.attributes?.["device_class"] ?? "")))
      .map((s) => ({
        id: s.entity_id,
        name: String(s.attributes?.["friendly_name"] ?? s.entity_id),
        state: s.state,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return ok(c, { available: true, sensors });
  } catch {
    return ok(c, { available: false, sensors: [] });
  }
});

// POST /api/motion-triggers — create
motionTriggersRouter.post("/", requireAdmin, async (c) => {
  const input = await parseTrigger(c);
  if (input instanceof Response) return input;
  const created = await createMotionTrigger(input);
  invalidateMotionTriggers();
  return ok(c, created, 201);
});

// PUT /api/motion-triggers/:id — replace
motionTriggersRouter.put("/:id", requireAdmin, async (c) => {
  const id = param(c, "id");
  if (!(await motionTriggerExists(id))) return fail(c, "NOT_FOUND", "Motion trigger not found.", 404);
  const input = await parseTrigger(c);
  if (input instanceof Response) return input;
  await updateMotionTrigger(id, input);
  invalidateMotionTriggers();
  return ok(c, { id });
});

// DELETE /api/motion-triggers/:id
motionTriggersRouter.delete("/:id", requireAdmin, async (c) => {
  await deleteMotionTrigger(param(c, "id"));
  invalidateMotionTriggers();
  return ok(c, { deleted: true });
});

// POST /api/motion-triggers/:id/test — play it now, ignoring its hours and cooldown
motionTriggersRouter.post("/:id/test", requireAdmin, async (c) => {
  invalidateMotionTriggers();
  const row = (await currentMotionTriggers()).find((t) => t.id === param(c, "id"));
  if (!row) return fail(c, "NOT_FOUND", "Motion trigger not found.", 404);
  const outcome = startTrigger(row, Date.now(), true);
  if (!outcome.fired) return fail(c, "NOT_PLAYED", `Not played: ${outcome.reason}.`, 409);
  return ok(c, outcome);
});
