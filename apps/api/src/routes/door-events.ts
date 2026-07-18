import { Hono } from "hono";
import { z } from "zod";
import type { MQTTDeviceManager } from "@platform/iot";
import { recordDoorEvent, listDoorEvents } from "@platform/db";
import { requireAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { broadcastToCms } from "../ws/gateway.js";

const toggleSchema = z.object({
  action: z.enum(["locked", "unlocked"]),
});

export function createDoorEventsRouter(mqtt: MQTTDeviceManager): Hono {
  const router = new Hono();

  router.use("*", requireAdmin);

  // GET /api/door-events — recent history + running total, newest first
  router.get("/", async (c) => {
    try {
      const result = await listDoorEvents(50);
      return ok(c, {
        total: result.total,
        items: result.items.map((e) => ({
          id: e.id,
          lockId: e.lockId,
          action: e.action,
          createdAt: e.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      console.error("[door-events] unhandled error:", err);
      return fail(c, "INTERNAL", "Something went wrong.", 500);
    }
  });

  // POST /api/door-events/toggle — manually toggle the lock state
  router.post("/toggle", async (c) => {
    const expectedLockId = process.env["YALE_LOCK_ID"];
    if (!expectedLockId) {
      return fail(c, "MISCONFIGURED", "Yale webhook is not configured", 503);
    }

    let body: z.infer<typeof toggleSchema>;
    try {
      body = toggleSchema.parse(await c.req.json());
    } catch (err) {
      if (err instanceof z.ZodError) {
        return fail(c, "VALIDATION", "Invalid request body", 400, err.issues);
      }
      return fail(c, "INVALID_BODY", "Request body must be valid JSON.", 400);
    }

    const { action } = body;
    const topic = `cms/door/${expectedLockId}/unlocked`;
    const value = action === "unlocked" ? "true" : "false";

    // Publish state to the broker so physical/logical local IoT devices sync
    const publish = mqtt.publishRaw(topic, value, { qos: 1, retain: true });
    publish.catch((err) => console.error("[door-events-manual] publish failed:", err));

    try {
      const event = await recordDoorEvent(expectedLockId, action);
      console.info(`[door-events-manual] door event recorded: ${action} at ${event.createdAt.toISOString()}`);
      const { total } = await listDoorEvents(1);
      broadcastToCms({
        type: "DOOR_EVENT",
        id: event.id,
        lockId: event.lockId,
        action: event.action as "locked" | "unlocked",
        createdAt: event.createdAt.toISOString(),
        total,
      });
    } catch (err) {
      console.error("[door-events-manual] failed to record/broadcast door event:", err);
    }

    return ok(c, { success: true });
  });

  return router;
}

