import { Hono } from "hono";
import { z } from "zod";
import { updateAmbientMode } from "@platform/db";
import { requireAdmin, requireGuestOrAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { getAmbientMode, listAmbientModes, applyAmbientMode } from "../services/ambient-modes.js";

/**
 * Whole-room lighting modes for the CMS Environment page: read them, edit a
 * mode's colour/brightness/strip setting, and apply one to the room. TRAVIS
 * applies the same modes through voice-actions, not through these routes.
 */
export const ambientModesRouter = new Hono();

// Anyone signed in can see and apply the modes; changing what a mode does is for admins.

const updateSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must look like #RRGGBB").optional(),
  brightness: z.number().int().min(0).max(100).optional(),
  stripOn: z.boolean().optional(),
});

// GET /api/ambient-modes
ambientModesRouter.get("/", requireGuestOrAdmin, async (c) => ok(c, await listAmbientModes()));

// PUT /api/ambient-modes/:key — change what a mode does (does not apply it)
ambientModesRouter.put("/:key", requireAdmin, async (c) => {
  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) return fail(c, "VALIDATION", "Invalid mode settings", 400, err.issues);
    return fail(c, "INVALID_BODY", "Request body must be valid JSON.", 400);
  }
  const patch = {
    ...(body.color !== undefined ? { color: body.color.toUpperCase() } : {}),
    ...(body.brightness !== undefined ? { brightness: body.brightness } : {}),
    ...(body.stripOn !== undefined ? { stripOn: body.stripOn } : {}),
  };
  const updated = await updateAmbientMode(c.req.param("key") ?? "", patch);
  if (!updated) return fail(c, "NOT_FOUND", "Unknown mode.", 404);
  return ok(c, updated);
});

// POST /api/ambient-modes/:key/apply — put the room into this mode
ambientModesRouter.post("/:key/apply", requireGuestOrAdmin, async (c) => {
  const mode = await getAmbientMode(c.req.param("key") ?? "");
  if (!mode) return fail(c, "NOT_FOUND", "Unknown mode.", 404);
  try {
    const result = await applyAmbientMode(mode);
    if (result.applied === 0 && result.failed > 0) {
      return fail(c, "DRIVER_ERROR", "None of the lights responded.", 502);
    }
    return ok(c, { key: mode.key, ...result });
  } catch (err: any) {
    return fail(c, "DRIVER_ERROR", err.message || "Lights failed to change.", 500);
  }
});
