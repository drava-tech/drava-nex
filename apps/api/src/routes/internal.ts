import { Hono } from "hono";
import type { Context } from "hono";
import {
  applyMatInventoryUpdate,
  applyProductDetection,
  broadcastToCms,
  clearProductDetection,
} from "../ws/gateway.js";
import { ok, fail } from "../lib/response.js";
import { showWelcomeScreenIfIdle, isVisionTriggerArmed } from "../services/door-screen-trigger.js";
import { setLatestSnapshot } from "../services/vision-snapshot-store.js";
import { secretsMatch, sourceIp, RateLimiter, logAuthFailure, logRateLimited } from "../lib/internal-auth.js";

/**
 * Internal event relay for headless backend services (services/vision).
 * Guarded by a shared secret, NOT a user session — it is called machine-to-
 * machine on the internal network, never from a browser. VISITOR_DETECTED
 * fans a face-vision identity match out to the CMS over WebSocket so the
 * Visitors list updates live. PERSON_PRESENT is identity-agnostic (fired
 * straight off raw detection) and is what drives the welcome-screen trigger.
 * CAMERA_SNAPSHOT feeds the CMS camera debug preview (see vision-snapshot.ts).
 * PRODUCT_DETECTED / PRODUCT_LOST are the single-item counterpart driven by
 * the browser detection loop over the screen WebSocket; handled here too
 * (delegating to gateway.applyProductDetection / clearProductDetection) so a
 * headless emitter (vision/events.py's emit_product/emit_product_lost) works
 * as well. INVENTORY_UPDATE is the multi-item counterpart used by
 * services/vision's dedicated-camera OBJECT worker (full current mat
 * contents, not a single best guess) — see gateway.applyMatInventoryUpdate.
 */
export const internalRouter = new Hono();

function checkSecret(c: Context): boolean {
  return secretsMatch(c.req.header("x-broadcast-secret"), process.env["BROADCAST_SECRET"]);
}

// This relay is fed by services/vision, an always-on headless emitter that
// can post frequently (e.g. per-frame CAMERA_SNAPSHOT) — a wider budget than
// voice-internal's, sized for that traffic pattern rather than occasional
// spoken commands.
const rateLimiter = new RateLimiter(600, 60_000);

internalRouter.post("/vision-event", async (c) => {
  const ip = sourceIp(c);
  if (!rateLimiter.check(ip)) {
    logRateLimited("internal/vision-event", c);
    return fail(c, "RATE_LIMITED", "Too many requests.", 429);
  }
  if (!checkSecret(c)) {
    logAuthFailure("internal/vision-event", c);
    return fail(c, "UNAUTHORIZED", "Unauthorized", 401);
  }

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

    case "PRODUCT_DETECTED": {
      // resolveDetectedProduct (inside applyProductDetection) does the schema
      // validation, confidence floor and ACTIVE-product lookup — a malformed or
      // low-confidence payload is rejected there, not here.
      const outcome = await applyProductDetection({
        cameraId: String(body["cameraId"] ?? ""),
        label: String(body["label"] ?? ""),
        confidence: Number(body["confidence"]),
        detectedAt: typeof body["detectedAt"] === "string" ? body["detectedAt"] : undefined,
      });
      return ok(c, outcome);
    }

    case "PRODUCT_LOST": {
      const cleared = await clearProductDetection({
        cameraId: String(body["cameraId"] ?? ""),
        label: String(body["label"] ?? ""),
      });
      return ok(c, { ok: true, cleared });
    }

    case "INVENTORY_UPDATE":
      // Full current mat contents from services/vision's dedicated-camera
      // OBJECT worker.
      await applyMatInventoryUpdate(String(body["cameraId"] ?? ""), body["items"]);
      return ok(c, { ok: true });

    default:
      return fail(c, "UNKNOWN_TYPE", `Unknown event type: ${String(body?.["type"])}`, 422);
  }
});
