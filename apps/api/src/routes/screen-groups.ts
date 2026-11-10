import { Hono } from "hono";
import { z } from "zod";
import {
  listScreenGroups,
  screenGroupExists,
  screenGroupNameExists,
  createScreenGroup,
  renameScreenGroup,
  deleteScreenGroup,
  setScreenGroupMembers,
  setScreenGroup,
  screenExists,
} from "@platform/db";
import { requireAdmin, requireGuestOrAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";

// Everything under /api/screen-groups. Anyone signed in can see the groups;
// only admins create, rename, delete or change who is in one.
export const screenGroupsRouter = new Hono();

function param(c: Parameters<typeof ok>[0], name: string): string {
  return (c.req.param() as Record<string, string | undefined>)[name] ?? "";
}

const nameSchema = z.object({ name: z.string() });
const membersSchema = z.object({ screenIds: z.array(z.string().min(1)).max(500) });
const screenGroupSchema = z.object({ groupId: z.string().min(1).nullable() });

async function parse<T>(c: Parameters<typeof ok>[0], schema: z.ZodType<T>): Promise<T | Response> {
  try {
    return schema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
}

// GET /api/screen-groups — list
screenGroupsRouter.get("/", requireGuestOrAdmin, async (c) => {
  return ok(c, await listScreenGroups());
});

// POST /api/screen-groups — create { name }
screenGroupsRouter.post("/", requireAdmin, async (c) => {
  const body = await parse(c, nameSchema);
  if (body instanceof Response) return body;
  const name = body.name.trim();
  if (!name) return fail(c, "VALIDATION", "Group name is required.", 400);
  if (name.length > 60) return fail(c, "VALIDATION", "Group name must be 60 characters or fewer.", 400);
  if (await screenGroupNameExists(name)) {
    return fail(c, "DUPLICATE", `A group named "${name}" already exists.`, 409);
  }
  return ok(c, await createScreenGroup(name), 201);
});

// PATCH /api/screen-groups/:id — rename { name }
screenGroupsRouter.patch("/:id", requireAdmin, async (c) => {
  const id = param(c, "id");
  const body = await parse(c, nameSchema);
  if (body instanceof Response) return body;
  const name = body.name.trim();
  if (!name) return fail(c, "VALIDATION", "Group name is required.", 400);
  if (name.length > 60) return fail(c, "VALIDATION", "Group name must be 60 characters or fewer.", 400);
  if (!(await screenGroupExists(id))) return fail(c, "NOT_FOUND", "Group not found.", 404);
  if (await screenGroupNameExists(name, id)) {
    return fail(c, "DUPLICATE", `A group named "${name}" already exists.`, 409);
  }
  await renameScreenGroup(id, name);
  return ok(c, { id, name });
});

// DELETE /api/screen-groups/:id — its screens become ungrouped
screenGroupsRouter.delete("/:id", requireAdmin, async (c) => {
  await deleteScreenGroup(param(c, "id"));
  return ok(c, { deleted: true });
});

// PUT /api/screen-groups/screen/:screenId — move one screen { groupId | null }.
// Registered before /:id/screens so "/screen/screens" can't be taken for a group id.
screenGroupsRouter.put("/screen/:screenId", requireAdmin, async (c) => {
  const screenId = param(c, "screenId");
  const body = await parse(c, screenGroupSchema);
  if (body instanceof Response) return body;
  if (!(await screenExists(screenId))) return fail(c, "NOT_FOUND", "Screen not found.", 404);
  if (body.groupId !== null && !(await screenGroupExists(body.groupId))) {
    return fail(c, "NOT_FOUND", "Group not found.", 404);
  }
  await setScreenGroup(screenId, body.groupId);
  return ok(c, { screenId, groupId: body.groupId });
});

// PUT /api/screen-groups/:id/screens — set exactly which screens are in it { screenIds }
screenGroupsRouter.put("/:id/screens", requireAdmin, async (c) => {
  const id = param(c, "id");
  const body = await parse(c, membersSchema);
  if (body instanceof Response) return body;
  if (!(await screenGroupExists(id))) return fail(c, "NOT_FOUND", "Group not found.", 404);
  await setScreenGroupMembers(id, [...new Set(body.screenIds)]);
  return ok(c, { id, screenIds: body.screenIds });
});
