import { Hono } from "hono";
import { requireAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { isGreetingEnabled } from "../lib/greeting-flag.js";
import { isVisionTriggerArmed } from "../services/door-screen-trigger.js";

/**
 * Operational view of greet-on-arrival, for staff (admin only).
 *
 * With GREETING_ENABLED off this answers { enabled: false } without loading any
 * greeting code or touching the database, so the route is inert until the
 * feature is switched on.
 */
export const greetingRouter = new Hono();

greetingRouter.use("*", requireAdmin);

// GET /api/greeting/status
greetingRouter.get("/status", async (c) => {
  if (!isGreetingEnabled()) return ok(c, { enabled: false, armed: isVisionTriggerArmed() });
  try {
    const greeting = await import("../services/greeting/index.js");
    return ok(c, await greeting.getGreetingStatus());
  } catch (err) {
    console.error("[greeting] status failed:", err);
    return fail(c, "INTERNAL", "Could not read the greeting status.", 500);
  }
});
