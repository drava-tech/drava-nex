import { Hono } from "hono";
import { z } from "zod";
import { isTemplateKey } from "@platform/types";
import {
  listExperiences,
  createExperience,
  reorderExperiences,
  softDeleteExperience,
  setExperienceTemplate,
  mergeExperienceTemplateContent,
  experienceSlugExists,
} from "@platform/db";
import { requireAdmin, type SessionUser } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";

// Everything under /api/experiences. The public GET list is unguarded (screens
// touch-picker reads it); mutations are guarded per-route (never router-wide, so
// the public GET is not intercepted).
export const experiencesRouter = new Hono();

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// --- Reads ---

// GET /api/experiences — public list (shape kept: { experiences: [{id,title}] })
experiencesRouter.get("/", async (c) => {
  return c.json({ experiences: await listExperiences() });
});

function userId(c: Parameters<typeof ok>[0]): string {
  return (c.get("user" as never) as SessionUser | undefined)?.id ?? "";
}

function param(c: Parameters<typeof ok>[0], name: string): string {
  return (c.req.param() as Record<string, string | undefined>)[name] ?? "";
}

// --- Create ---

const createSchema = z.object({
  name: z.string(),
  slug: z.string(),
  templateKey: z.string().nullable().optional(),
  typeIds: z.array(z.string()).optional(),
});

// POST /api/experiences — create
experiencesRouter.post("/", requireAdmin, async (c) => {
  let body;
  try {
    body = createSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  const name = body.name.trim();
  const slug = body.slug.trim();
  if (!name) return fail(c, "VALIDATION", "Project name is required.", 400);
  if (!slug) return fail(c, "VALIDATION", "Slug is required.", 400);
  if (!SLUG_REGEX.test(slug)) {
    return fail(
      c,
      "VALIDATION",
      "Slug must use only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen.",
      400
    );
  }
  if (body.templateKey != null && !isTemplateKey(body.templateKey)) {
    return fail(c, "VALIDATION", `Unknown template: "${body.templateKey}".`, 400);
  }
  if (await experienceSlugExists(slug)) {
    return fail(c, "DUPLICATE", `A project with slug "${slug}" already exists.`, 409);
  }

  const created = await createExperience({
    name,
    slug,
    templateKey: body.templateKey ?? null,
    createdByUserId: userId(c),
    typeIds: body.typeIds ?? [],
  });
  return ok(c, created, 201);
});

// --- Collection action: reorder ---

const reorderSchema = z.object({ orderedIds: z.array(z.string()) });

// POST /api/experiences/reorder
experiencesRouter.post("/reorder", requireAdmin, async (c) => {
  let body;
  try {
    body = reorderSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  await reorderExperiences(body.orderedIds);
  return ok(c, { reordered: body.orderedIds.length });
});

// --- Delete ---

// DELETE /api/experiences/:id — soft-delete
experiencesRouter.delete("/:id", requireAdmin, async (c) => {
  await softDeleteExperience(param(c, "id"));
  return ok(c, { deleted: true });
});

// --- Nested: template + content ---

const templateSchema = z.object({ templateKey: z.string().nullable() });

// PATCH /api/experiences/:id/template — assign/clear template
experiencesRouter.patch("/:id/template", requireAdmin, async (c) => {
  let body;
  try {
    body = templateSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  if (body.templateKey !== null && !isTemplateKey(body.templateKey)) {
    return fail(c, "VALIDATION", `Unknown template: "${body.templateKey}".`, 400);
  }
  await setExperienceTemplate(param(c, "id"), body.templateKey, userId(c));
  return ok(c, { updated: true });
});

const contentSchema = z.object({ templateKey: z.string(), content: z.unknown() });

// PATCH /api/experiences/:id/content — merge template content
experiencesRouter.patch("/:id/content", requireAdmin, async (c) => {
  let body;
  try {
    body = contentSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  if (!isTemplateKey(body.templateKey)) {
    return fail(c, "VALIDATION", `Unknown template: "${body.templateKey}".`, 400);
  }
  await mergeExperienceTemplateContent(param(c, "id"), body.templateKey, body.content, userId(c));
  return ok(c, { updated: true });
});
