import { Hono } from "hono";
import type { Context } from "hono";
import { broadcastToCms } from "../ws/gateway.js";
import { ok, fail } from "../lib/response.js";

/**
 * Internal event relay for headless backend services (services/vision).
 * Guarded by a shared secret, NOT a user session — it is called machine-to-
 * machine on the internal network, never from a browser. Today it fans a
 * face-vision detection out to the CMS over WebSocket so the Visitors list
 * updates live. PRODUCT_DETECTED is accepted as a no-op stub so the Python
 * side can emit it once object detection is built, without an API change.
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

    case "PRODUCT_DETECTED":
      // Object detection not built yet — accept + no-op so the Python side can
      // emit without a 4xx. Wire resolveDetectedProduct + broadcast here later.
      return ok(c, { ok: true });

    default:
      return fail(c, "UNKNOWN_TYPE", `Unknown event type: ${String(body?.["type"])}`, 422);
  }
});
