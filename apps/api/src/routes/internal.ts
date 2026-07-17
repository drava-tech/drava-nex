import { Hono } from "hono";
import type { Context } from "hono";
import { broadcastToCms } from "../ws/gateway.js";
import { ok, fail } from "../lib/response.js";
import { showWelcomeScreenIfIdle, isVisionTriggerArmed } from "../services/door-screen-trigger.js";
import { setLatestSnapshot } from "../services/vision-snapshot-store.js";

/**
 * Internal event relay for headless backend services (services/vision).
 * Guarded by a shared secret, NOT a user session — it is called machine-to-
 * machine on the internal network, never from a browser. VISITOR_DETECTED
 * fans a face-vision identity match out to the CMS over WebSocket so the
 * Visitors list updates live. PERSON_PRESENT is identity-agnostic (fired
 * straight off raw detection) and is what drives the welcome-screen trigger.
 * CAMERA_SNAPSHOT feeds the CMS camera debug preview (see vision-snapshot.ts).
 * PRODUCT_DETECTED is accepted as a no-op stub so the Python side can emit it
 * once object detection is built, without an API change.
 */
export const internalRouter = new Hono();

function checkSecret(c: Context): boolean {
  const expected = process.env["BROADCAST_SECRET"];
  return !!expected && c.req.header("x-broadcast-secret") === expected;
}

internalRouter.post("/vision-event", async (c) => {
  if (!checkSecret(c)) return fail(c, "UNAUTHORIZED", "Unauthorized", 401);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, "INVALID_BODY", "Request body must be valid JSON.", 422);
  }

  switch (body?.["type"]) {
    case "VISITOR_DETECTED":
      broadcastToCms({
        type: "VISITOR_DETECTED",
        uuid: String(body["uuid"] ?? ""),
        name: String(body["name"] ?? ""),
        isNew: Boolean(body["isNew"]),
        lastSeen: String(body["lastSeen"] ?? ""),
        hasImage: Boolean(body["hasImage"]),
      });
      return ok(c, { ok: true });

    case "PERSON_PRESENT":
      // Identity-agnostic — any human in frame. Gated by the manual kill
      // switch (see /api/vision-trigger) and idle-guarded on top so it never
      // disrupts real assigned content.
      if (isVisionTriggerArmed()) {
        showWelcomeScreenIfIdle(new Date()).catch((err) =>
          console.error("[vision-event] failed to show welcome screen:", err)
        );
      }
      return ok(c, { ok: true });

    case "CAMERA_STATUS":
      // Face cameras have no screen mapping yet; screenId is intentionally "".
      broadcastToCms({
        type: "CAMERA_STATUS_UPDATE",
        cameraId: String(body["cameraId"] ?? ""),
        screenId: "",
        status: String(body["status"] ?? "online") as never,
        timestamp: Date.now(),
      });
      return ok(c, { ok: true });

    case "CAMERA_SNAPSHOT": {
      // Debug-only visual aid for the CMS camera preview — decode + store the
      // latest JPEG in memory; served by GET /api/vision-snapshot/:cameraId.
      const jpegBase64 = body["jpegBase64"];
      if (typeof jpegBase64 === "string") {
        setLatestSnapshot(String(body["cameraId"] ?? ""), Buffer.from(jpegBase64, "base64"));
      }
      return ok(c, { ok: true });
    }

    case "PRODUCT_DETECTED":
      // Object detection not built yet — accept + no-op so the Python side can
      // emit without a 4xx. Wire resolveDetectedProduct + broadcast here later.
      return ok(c, { ok: true });

    default:
      return fail(c, "UNKNOWN_TYPE", `Unknown event type: ${String(body?.["type"])}`, 422);
  }
});
