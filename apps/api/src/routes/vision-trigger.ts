import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { isVisionTriggerArmed, setVisionTriggerArmed } from "../services/door-screen-trigger.js";

// Manual test control for the face-detection → welcome-screen trigger. Lets
// staff arm/disarm from the CMS so the behavior can be verified on demand
// without a face constantly re-triggering the screen during normal use.
export const visionTriggerRouter = new Hono();

visionTriggerRouter.use("*", requireAdmin);

// GET /api/vision-trigger — current armed state
visionTriggerRouter.get("/", (c) => {
  return ok(c, { armed: isVisionTriggerArmed() });
});

const setArmedSchema = z.object({ armed: z.boolean() });

// POST /api/vision-trigger — arm/disarm
visionTriggerRouter.post("/", async (c) => {
  let body: z.infer<typeof setArmedSchema>;
  try {
    body = setArmedSchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return fail(c, "VALIDATION", "Invalid request body", 400, err.issues);
    }
    return fail(c, "INVALID_BODY", "Request body must be valid JSON.", 400);
  }
  setVisionTriggerArmed(body.armed);
  return ok(c, { armed: body.armed });
});
