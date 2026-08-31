import { Hono } from "hono";
import type { Context } from "hono";
import {
  getPortfolioTree,
  updateVertical,
  updateCategory,
  addCategoryImage,
  removeCategoryImage,
  reorderCategoryImages,
  addCategoryVideo,
  removeCategoryVideo,
  reorderCategoryVideos,
  createProject,
  updateProject,
  deleteProject,
  reorderProjects,
  addProjectImage,
  removeProjectImage,
  reorderProjectImages,
  addProjectVideo,
  removeProjectVideo,
  reorderProjectVideos,
  getOrCreatePortfolioSettings,
  updatePortfolioSettings,
  PortfolioNotFoundError,
  PortfolioValidationError,
} from "@platform/db";
import {
  updateVerticalSchema,
  updateCategorySchema,
  addCategoryMediaSchema,
  reorderSchema,
  createProjectSchema,
  updateProjectSchema,
  addProjectImageSchema,
  addProjectVideoSchema,
  updatePortfolioSettingsSchema,
  formatZodError,
} from "@platform/types";
import type { z } from "zod";
import { requireAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";

/** Read a route param as a definite string (the route pattern guarantees it). */
function getParam(c: Context, name: string): string {
  return (c.req.param() as Record<string, string | undefined>)[name] ?? "";
}

/** Translate thrown errors into the standard envelope without leaking internals. */
function handleError(c: Parameters<typeof ok>[0], err: unknown) {
  if (err instanceof PortfolioNotFoundError) {
    return fail(c, "NOT_FOUND", err.message, 404);
  }
  if (err instanceof PortfolioValidationError) {
    return fail(c, "VALIDATION", err.message, 422);
  }
  console.error("[portfolio] unhandled error:", err);
  return fail(c, "INTERNAL", "Something went wrong.", 500);
}

/** Read + zod-validate a JSON body; returns the parsed value or sends a 422. */
async function parseBody<T extends z.ZodTypeAny>(
  c: Parameters<typeof ok>[0],
  schema: T
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, res: fail(c, "INVALID_BODY", "Request body must be valid JSON.", 422) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      res: fail(c, "VALIDATION", "Validation failed.", 422, formatZodError(result.error)),
    };
  }
  return { ok: true, data: result.data };
}

export const portfolioRouter = new Hono();

// --- Tree read ---

// GET /api/portfolio/experiences/:experienceId — full assembled tree (admin)
portfolioRouter.get("/experiences/:experienceId", requireAdmin, async (c) => {
  try {
    const tree = await getPortfolioTree(getParam(c, "experienceId"));
    if (!tree) return fail(c, "NOT_FOUND", "No portfolio content for this experience.", 404);
    return ok(c, tree);
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Settings ---

// PATCH /api/portfolio/experiences/:experienceId/settings — upsert (admin)
portfolioRouter.patch("/experiences/:experienceId/settings", requireAdmin, async (c) => {
  const body = await parseBody(c, updatePortfolioSettingsSchema);
  if (!body.ok) return body.res;
  try {
    const experienceId = getParam(c, "experienceId");
    await getOrCreatePortfolioSettings(experienceId);
    return ok(c, await updatePortfolioSettings(experienceId, body.data));
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Verticals (fixed 3 slots — update only) ---

// PATCH /api/portfolio/verticals/:verticalId (admin)
portfolioRouter.patch("/verticals/:verticalId", requireAdmin, async (c) => {
  const body = await parseBody(c, updateVerticalSchema);
  if (!body.ok) return body.res;
  try {
    return ok(c, await updateVertical(getParam(c, "verticalId"), body.data));
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Categories (fixed 2 slots per vertical — update only, incl. type switch) ---

// PATCH /api/portfolio/categories/:categoryId (admin)
portfolioRouter.patch("/categories/:categoryId", requireAdmin, async (c) => {
  const body = await parseBody(c, updateCategorySchema);
  if (!body.ok) return body.res;
  try {
    return ok(c, await updateCategory(getParam(c, "categoryId"), body.data));
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Category images ---

portfolioRouter.post("/categories/:categoryId/images", requireAdmin, async (c) => {
  const body = await parseBody(c, addCategoryMediaSchema);
  if (!body.ok) return body.res;
  try {
    const row = await addCategoryImage(getParam(c, "categoryId"), body.data.url, body.data.sortOrder ?? 0);
    return ok(c, row, 201);
  } catch (err) {
    return handleError(c, err);
  }
});

portfolioRouter.delete("/categories/:categoryId/images/:imageId", requireAdmin, async (c) => {
  try {
    await removeCategoryImage(getParam(c, "categoryId"), getParam(c, "imageId"));
    return ok(c, { id: getParam(c, "imageId"), deleted: true });
  } catch (err) {
    return handleError(c, err);
  }
});

portfolioRouter.post("/categories/:categoryId/images/reorder", requireAdmin, async (c) => {
  const body = await parseBody(c, reorderSchema);
  if (!body.ok) return body.res;
  try {
    await reorderCategoryImages(getParam(c, "categoryId"), body.data.orderedIds);
    return ok(c, { reordered: true });
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Category videos ---

portfolioRouter.post("/categories/:categoryId/videos", requireAdmin, async (c) => {
  const body = await parseBody(c, addCategoryMediaSchema);
  if (!body.ok) return body.res;
  try {
    const row = await addCategoryVideo(getParam(c, "categoryId"), body.data.url, body.data.sortOrder ?? 0);
    return ok(c, row, 201);
  } catch (err) {
    return handleError(c, err);
  }
});

portfolioRouter.delete("/categories/:categoryId/videos/:videoId", requireAdmin, async (c) => {
  try {
    await removeCategoryVideo(getParam(c, "categoryId"), getParam(c, "videoId"));
    return ok(c, { id: getParam(c, "videoId"), deleted: true });
  } catch (err) {
    return handleError(c, err);
  }
});

portfolioRouter.post("/categories/:categoryId/videos/reorder", requireAdmin, async (c) => {
  const body = await parseBody(c, reorderSchema);
  if (!body.ok) return body.res;
  try {
    await reorderCategoryVideos(getParam(c, "categoryId"), body.data.orderedIds);
    return ok(c, { reordered: true });
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Projects (free add/remove/reorder list inside a "gallery" category) ---

portfolioRouter.post("/categories/:categoryId/projects", requireAdmin, async (c) => {
  const body = await parseBody(c, createProjectSchema);
  if (!body.ok) return body.res;
  try {
    return ok(c, await createProject(getParam(c, "categoryId"), body.data), 201);
  } catch (err) {
    return handleError(c, err);
  }
});

portfolioRouter.post("/categories/:categoryId/projects/reorder", requireAdmin, async (c) => {
  const body = await parseBody(c, reorderSchema);
  if (!body.ok) return body.res;
  try {
    await reorderProjects(getParam(c, "categoryId"), body.data.orderedIds);
    return ok(c, { reordered: true });
  } catch (err) {
    return handleError(c, err);
  }
});

portfolioRouter.patch("/projects/:projectId", requireAdmin, async (c) => {
  const body = await parseBody(c, updateProjectSchema);
  if (!body.ok) return body.res;
  try {
    return ok(c, await updateProject(getParam(c, "projectId"), body.data));
  } catch (err) {
    return handleError(c, err);
  }
});

portfolioRouter.delete("/projects/:projectId", requireAdmin, async (c) => {
  try {
    await deleteProject(getParam(c, "projectId"));
    return ok(c, { id: getParam(c, "projectId"), deleted: true });
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Project images ---

portfolioRouter.post("/projects/:projectId/images", requireAdmin, async (c) => {
  const body = await parseBody(c, addProjectImageSchema);
  if (!body.ok) return body.res;
  try {
    const row = await addProjectImage(getParam(c, "projectId"), body.data.url, body.data.sortOrder ?? 0);
    return ok(c, row, 201);
  } catch (err) {
    return handleError(c, err);
  }
});

portfolioRouter.delete("/projects/:projectId/images/:imageId", requireAdmin, async (c) => {
  try {
    await removeProjectImage(getParam(c, "projectId"), getParam(c, "imageId"));
    return ok(c, { id: getParam(c, "imageId"), deleted: true });
  } catch (err) {
    return handleError(c, err);
  }
});

portfolioRouter.post("/projects/:projectId/images/reorder", requireAdmin, async (c) => {
  const body = await parseBody(c, reorderSchema);
  if (!body.ok) return body.res;
  try {
    await reorderProjectImages(getParam(c, "projectId"), body.data.orderedIds);
    return ok(c, { reordered: true });
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Project videos ---

portfolioRouter.post("/projects/:projectId/videos", requireAdmin, async (c) => {
  const body = await parseBody(c, addProjectVideoSchema);
  if (!body.ok) return body.res;
  try {
    const row = await addProjectVideo(getParam(c, "projectId"), body.data.url, body.data.sortOrder ?? 0);
    return ok(c, row, 201);
  } catch (err) {
    return handleError(c, err);
  }
});

portfolioRouter.delete("/projects/:projectId/videos/:videoId", requireAdmin, async (c) => {
  try {
    await removeProjectVideo(getParam(c, "projectId"), getParam(c, "videoId"));
    return ok(c, { id: getParam(c, "videoId"), deleted: true });
  } catch (err) {
    return handleError(c, err);
  }
});

portfolioRouter.post("/projects/:projectId/videos/reorder", requireAdmin, async (c) => {
  const body = await parseBody(c, reorderSchema);
  if (!body.ok) return body.res;
  try {
    await reorderProjectVideos(getParam(c, "projectId"), body.data.orderedIds);
    return ok(c, { reordered: true });
  } catch (err) {
    return handleError(c, err);
  }
});
