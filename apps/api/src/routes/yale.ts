import { Hono } from "hono";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import type { MQTTDeviceManager } from "@platform/iot";
import { recordDoorEvent, listDoorEvents } from "@platform/db";
import { ok, fail } from "../lib/response.js";
import { broadcastToCms } from "../ws/gateway.js";

/**
 * Yale Zuri S → MQTT bridge. IFTTT ("Make a web request") POSTs lock events
 * here; we re-broadcast the door state to the local broker as a retained
 * QoS 1 message so LAN devices always see the last known state.
 *
 * Guarded machine-to-machine like internal.ts, but IFTTT cannot set custom
 * headers, so the shared secret arrives as ?token=… (or a body field) instead
 * of a header. The payload lockId must also match the configured hardware ID.
 */

const payloadSchema = z.object({
  lockId: z.string().min(1),
  action: z.string().min(1),
  token: z.string().optional(),
});

// Broker ack wait before falling back to "queued" (mqtt.js keeps the packet
// buffered and delivers it on reconnect, so a timeout is not a loss).
const PUBLISH_ACK_TIMEOUT_MS = 3_000;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createYaleRouter(mqtt: MQTTDeviceManager): Hono {
  const router = new Hono();

  router.post("/", async (c) => {
    const expectedLockId = process.env["YALE_LOCK_ID"];
    const expectedToken = process.env["YALE_WEBHOOK_TOKEN"];
    if (!expectedLockId || !expectedToken) {
      return fail(c, "MISCONFIGURED", "Yale webhook is not configured", 503);
    }

    let body: z.infer<typeof payloadSchema>;
    try {
      body = payloadSchema.parse(await c.req.json());
    } catch (err) {
      if (err instanceof z.ZodError) {
        return fail(c, "VALIDATION", "Invalid request body", 400, err.issues);
      }
      return fail(c, "INVALID_BODY", "Request body must be valid JSON.", 400);
    }

    const token = c.req.query("token") ?? body.token ?? "";
    if (!safeEqual(token, expectedToken)) {
      return fail(c, "UNAUTHORIZED", "Unauthorized", 401);
    }
    if (body.lockId !== expectedLockId) {
      return fail(c, "UNAUTHORIZED", "Unauthorized", 401);
    }

    // Topic is derived from the trusted env value, never from the payload.
    const topic = `cms/door/${expectedLockId}/unlocked`;
    const action: "locked" | "unlocked" = body.action === "unlocked" ? "unlocked" : "locked";
    const value = action === "unlocked" ? "true" : "false";

    const publish = mqtt.publishRaw(topic, value, { qos: 1, retain: true });
    publish.catch((err) => console.error("[yale] publish failed:", err));

    // Persist + notify the CMS regardless of MQTT delivery — the webhook call
    // itself is the event of record for the live Door Lock panel's history.
    try {
      const event = await recordDoorEvent(expectedLockId, action);
      console.info(`[yale] door event recorded: ${action} at ${event.createdAt.toISOString()}`);
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
      console.error("[yale] failed to record/broadcast door event:", err);
    }

    // Broker down: the packet is queued client-side and flushed on reconnect;
    // retain:true is last-write-wins, so accept and tell IFTTT 202.
    if (!mqtt.isConnected()) {
      return ok(c, { queued: true, topic, value }, 202);
    }

    try {
      await Promise.race([
        publish,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ack timeout")), PUBLISH_ACK_TIMEOUT_MS)
        ),
      ]);
      return ok(c, { published: true, topic, value });
    } catch {
      return ok(c, { queued: true, topic, value }, 202);
    }
  });

  return router;
}
