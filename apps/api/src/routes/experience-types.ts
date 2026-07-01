import { Hono } from "hono";
import { z } from "zod";
import {
  listExperienceTypes,
  experienceTypeNameExists,
  createExperienceType,
  deleteExperienceType,
} from "@platform/db";
import { requireAdmin, requireGuestOrAdmin, type SessionUser } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";

export const experienceTypesRouter = new Hono();

// --- Reads ---

// GET /api/experience-types — list (guest or admin)
experienceTypesRouter.get("/", requireGuestOrAdmin, async (c) => {
  return ok(c, await listExperienceTypes());
});

// --- Create ---

const createSchema = z.object({ name: z.string() });

// POST /api/experience-types — create
experienceTypesRouter.post("/", requireAdmin, async (c) => {
  let body;
  try {
    body = createSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  const name = body.name.trim();
  if (!name) return fail(c, "VALIDATION", "Type name is required.", 400);
  if (await experienceTypeNameExists(name)) {
    return fail(c, "DUPLICATE", `A type named "${name}" already exists.`, 409);
  }
  const created = await createExperienceType({
    name,
    createdByUserId: (c.get("user" as never) as SessionUser).id,
  });
  return ok(c, created, 201);
});

// --- Delete ---

// DELETE /api/experience-types/:id
experienceTypesRouter.delete("/:id", requireAdmin, async (c) => {
  await deleteExperienceType(c.req.param("id") ?? "");
  return ok(c, { deleted: true });
});
