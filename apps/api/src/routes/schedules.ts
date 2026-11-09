import { Hono } from "hono";
import { z } from "zod";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  scheduleExists,
  setScheduleEnabled,
  updateSchedule,
  type ScheduleInput,
} from "@platform/db";
import { isValidTimezone, MAX_ITEM_SECONDS, MIN_ITEM_SECONDS, parseTimeOfDay } from "@platform/types";
import { requireAdmin, requireGuestOrAdmin, type SessionUser } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { runSchedulerSoon, scheduleStatus } from "../services/scheduler.js";

// Everything under /api/schedules. Anyone signed in can see schedules and
// what's on air; only admins create, edit, switch off or delete them. Every
// change re-runs the scheduler at once, so it takes effect on the screens
// without waiting for the next tick.
export const schedulesRouter = new Hono();

function param(c: Parameters<typeof ok>[0], name: string): string {
  return (c.req.param() as Record<string, string | undefined>)[name] ?? "";
}

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD.");
const timeString = z.string().refine((v) => parseTimeOfDay(v) !== null, "Times are HH:MM (24-hour).");

const scheduleSchema = z
  .object({
    name: z.string().trim().min(1, "Give the schedule a name.").max(80),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #92ff5f."),
    enabled: z.boolean(),
    priority: z.number().int().min(-100).max(100),
    startDate: dateString.nullable(),
    endDate: dateString.nullable(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day.").max(7),
    startTime: timeString.nullable(),
    endTime: timeString.nullable(),
    timezone: z.string().refine(isValidTimezone, "Unknown timezone."),
    // Optional for callers that predate it: a schedule repeats unless told otherwise.
    loop: z.boolean().default(true),
    screenIds: z.array(z.string().min(1)).max(500),
    groupIds: z.array(z.string().min(1)).max(500),
    items: z
      .array(
        z.object({
          kind: z.enum(["experience", "media"]),
          contentId: z.string().min(1),
          durationSeconds: z.number().int().min(MIN_ITEM_SECONDS).max(MAX_ITEM_SECONDS),
        })
      )
      .max(200),
  })
  .refine((s) => (s.startTime === null) === (s.endTime === null), {
    message: "Set both a start and an end time, or neither for all day.",
    path: ["endTime"],
  })
  .refine((s) => !s.startDate || !s.endDate || s.startDate <= s.endDate, {
    message: "The end date is before the start date.",
    path: ["endDate"],
  });

async function parseSchedule(c: Parameters<typeof ok>[0]): Promise<ScheduleInput | Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return fail(c, "VALIDATION", "Invalid request body", 400);
  }
  const result = scheduleSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    return fail(c, "VALIDATION", first?.message ?? "Invalid schedule", 400, result.error.issues);
  }
  const s = result.data;
  return {
    ...s,
    daysOfWeek: [...new Set(s.daysOfWeek)].sort(),
    screenIds: [...new Set(s.screenIds)],
    groupIds: [...new Set(s.groupIds)],
  };
}

/** A playlist item pointing at content that was deleted in the meantime. */
function isMissingContent(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23503";
}

// GET /api/schedules — every schedule with its playlist
schedulesRouter.get("/", requireGuestOrAdmin, async (c) => {
  return ok(c, await listSchedules());
});

// GET /api/schedules/now — per screen: what's on air, and what's next.
// Registered before /:id so "now" isn't taken for an id.
schedulesRouter.get("/now", requireGuestOrAdmin, async (c) => {
  return ok(c, { now: new Date().toISOString(), screens: await scheduleStatus() });
});

// POST /api/schedules — create
schedulesRouter.post("/", requireAdmin, async (c) => {
  const input = await parseSchedule(c);
  if (input instanceof Response) return input;
  try {
    const created = await createSchedule(input, (c.get("user" as never) as SessionUser | undefined)?.id ?? null);
    runSchedulerSoon();
    return ok(c, created, 201);
  } catch (err) {
    if (isMissingContent(err)) return fail(c, "VALIDATION", "Some content in the playlist no longer exists.", 400);
    throw err;
  }
});

// PUT /api/schedules/:id — replace settings and playlist
schedulesRouter.put("/:id", requireAdmin, async (c) => {
  const id = param(c, "id");
  if (!(await scheduleExists(id))) return fail(c, "NOT_FOUND", "Schedule not found.", 404);
  const input = await parseSchedule(c);
  if (input instanceof Response) return input;
  try {
    await updateSchedule(id, input);
    runSchedulerSoon();
    return ok(c, { id });
  } catch (err) {
    if (isMissingContent(err)) return fail(c, "VALIDATION", "Some content in the playlist no longer exists.", 400);
    throw err;
  }
});

// PATCH /api/schedules/:id — switch on/off { enabled }
schedulesRouter.patch("/:id", requireAdmin, async (c) => {
  const id = param(c, "id");
  let body: { enabled: boolean };
  try {
    body = z.object({ enabled: z.boolean() }).parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  if (!(await scheduleExists(id))) return fail(c, "NOT_FOUND", "Schedule not found.", 404);
  await setScheduleEnabled(id, body.enabled);
  runSchedulerSoon();
  return ok(c, { id, enabled: body.enabled });
});

// DELETE /api/schedules/:id — screens it was running are handed back on the next tick
schedulesRouter.delete("/:id", requireAdmin, async (c) => {
  await deleteSchedule(param(c, "id"));
  runSchedulerSoon();
  return ok(c, { deleted: true });
});
