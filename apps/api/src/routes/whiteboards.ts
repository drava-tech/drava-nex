import { Hono } from "hono";
import { z } from "zod";
import {
  listWhiteboardDocuments,
  getWhiteboardDocument,
  createWhiteboardDocument,
  updateWhiteboardDocument,
  softDeleteWhiteboardDocument,
} from "@platform/db";
import { requireGuestOrAdmin, type SessionUser } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";

// Everything under /api/whiteboards. Saved, re-editable, multi-page whiteboard
// documents — same access level as screen content assignment (requireGuestOrAdmin
// throughout), since saving/pushing a whiteboard is an operational action, not
// admin-only content management.
export const whiteboardsRouter = new Hono();

function userId(c: Parameters<typeof ok>[0]): string {
  return (c.get("user" as never) as SessionUser | undefined)?.id ?? "";
}

function param(c: Parameters<typeof ok>[0], name: string): string {
  return (c.req.param() as Record<string, string | undefined>)[name] ?? "";
}

// --- Reads ---

// GET /api/whiteboards — list (id, name, timestamps; no page content, keep it light)
whiteboardsRouter.get("/", requireGuestOrAdmin, async (c) => {
  const docs = await listWhiteboardDocuments();
  return ok(
    c,
    docs.map((d) => ({
      id: d.id,
      name: d.name,
      pageCount: Array.isArray(d.pages) ? d.pages.length : 0,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }))
  );
});

// GET /api/whiteboards/:id — full document, pages included
whiteboardsRouter.get("/:id", requireGuestOrAdmin, async (c) => {
  const doc = await getWhiteboardDocument(param(c, "id"));
  if (!doc) return fail(c, "NOT_FOUND", "Whiteboard not found.", 404);
  return ok(c, doc);
});

// --- Create ---

const pageSchema = z.object({
  surface: z.enum(["light", "dark", "clear"]),
  strokes: z.array(z.unknown()),
});
const createSchema = z.object({
  name: z.string(),
  pages: z.array(pageSchema).min(1),
});

// POST /api/whiteboards — save a new whiteboard
whiteboardsRouter.post("/", requireGuestOrAdmin, async (c) => {
  let body;
  try {
    body = createSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  const name = body.name.trim();
  if (!name) return fail(c, "VALIDATION", "Whiteboard name is required.", 400);

  const created = await createWhiteboardDocument({
    name,
    pages: body.pages,
    createdByUserId: userId(c),
  });
  return ok(c, created, 201);
});

// --- Update ---

const updateSchema = z.object({
  name: z.string().optional(),
  pages: z.array(pageSchema).min(1).optional(),
});

// PUT /api/whiteboards/:id — re-save (name and/or pages)
whiteboardsRouter.put("/:id", requireGuestOrAdmin, async (c) => {
  let body;
  try {
    body = updateSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  const name = body.name?.trim();
  if (body.name !== undefined && !name) {
    return fail(c, "VALIDATION", "Whiteboard name is required.", 400);
  }

  const updated = await updateWhiteboardDocument(param(c, "id"), {
    ...(name !== undefined ? { name } : {}),
    ...(body.pages !== undefined ? { pages: body.pages } : {}),
    updatedByUserId: userId(c),
  });
  if (!updated) return fail(c, "NOT_FOUND", "Whiteboard not found.", 404);
  return ok(c, updated);
});

// --- Delete ---

// DELETE /api/whiteboards/:id — soft-delete
whiteboardsRouter.delete("/:id", requireGuestOrAdmin, async (c) => {
  await softDeleteWhiteboardDocument(param(c, "id"));
  return ok(c, { deleted: true });
});
