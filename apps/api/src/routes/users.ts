import { Hono } from "hono";
import { z } from "zod";
import {
  deleteUserById,
  deleteUserSessions,
  getUserByEmail,
  getUserById,
  listUsers,
  setUserRole,
} from "@platform/db";
import { requireSuperAdmin, type SessionUser } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { auth } from "../lib/auth.js";

// Everything under /api/users: who can sign in to Nex. Only the super admin
// manages accounts. There is no self sign-up (nginx blocks it); accounts are
// made here.
//
// Roles: SUPERADMIN (one, can't be changed or removed here), ADMIN (everything
// but accounts), GUEST — shown as "User" in the CMS — who operates Nex
// (push content, control screens) but can't change settings or screens.
export const usersRouter = new Hono();
usersRouter.use("*", requireSuperAdmin);

const roleSchema = z.enum(["ADMIN", "GUEST"]);
const passwordSchema = z.string().min(8, "The password needs at least 8 characters.").max(128);

const createSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: passwordSchema,
  role: roleSchema,
});

function param(c: Parameters<typeof ok>[0], name: string): string {
  return (c.req.param() as Record<string, string | undefined>)[name] ?? "";
}

async function body<T>(c: Parameters<typeof ok>[0], schema: z.ZodType<T>): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return fail(c, "VALIDATION", "Invalid request body", 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return fail(c, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request body", 400, parsed.error.issues);
  }
  return parsed.data;
}

/** The account being changed must exist, and mustn't be the super admin or yourself. */
async function changeableTarget(c: Parameters<typeof ok>[0], id: string) {
  const me = c.get("user" as never) as SessionUser | undefined;
  if (me?.id === id) return fail(c, "FORBIDDEN", "You can't change your own account here.", 403);
  const target = await getUserById(id);
  if (!target) return fail(c, "NOT_FOUND", "User not found.", 404);
  if (target.role === "SUPERADMIN") return fail(c, "FORBIDDEN", "The super admin account can't be changed here.", 403);
  return target;
}

// GET /api/users — everyone who can sign in
usersRouter.get("/", async (c) => ok(c, await listUsers()));

// POST /api/users — add an account { name, email, password, role }
usersRouter.post("/", async (c) => {
  const input = await body(c, createSchema);
  if (input instanceof Response) return input;
  if (await getUserByEmail(input.email)) {
    return fail(c, "DUPLICATE", `${input.email} already has an account.`, 409);
  }
  const result = await auth.api.signUpEmail({
    body: { email: input.email, password: input.password, name: input.name },
  });
  if (!result?.user) return fail(c, "INTERNAL", "Failed to create the account.", 500);
  // New accounts start as GUEST (Better Auth's default for the role field).
  if (input.role !== "GUEST") await setUserRole(result.user.id, input.role);
  return ok(c, { id: result.user.id }, 201);
});

// PATCH /api/users/:id — change role { role }; they're signed out so it applies at once
usersRouter.patch("/:id", async (c) => {
  const id = param(c, "id");
  const input = await body(c, z.object({ role: roleSchema }));
  if (input instanceof Response) return input;
  const target = await changeableTarget(c, id);
  if (target instanceof Response) return target;
  await setUserRole(id, input.role);
  // Session cookies cache the role for minutes; a fresh sign-in picks up the new one.
  await deleteUserSessions(id);
  return ok(c, { id, role: input.role });
});

// POST /api/users/:id/password — set a new password { password }; signs them out everywhere
usersRouter.post("/:id/password", async (c) => {
  const id = param(c, "id");
  const input = await body(c, z.object({ password: passwordSchema }));
  if (input instanceof Response) return input;
  const target = await changeableTarget(c, id);
  if (target instanceof Response) return target;
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);
  await ctx.internalAdapter.updatePassword(id, hash);
  await deleteUserSessions(id);
  return ok(c, { id });
});

// DELETE /api/users/:id — remove an account (their sessions go with it)
usersRouter.delete("/:id", async (c) => {
  const id = param(c, "id");
  const target = await changeableTarget(c, id);
  if (target instanceof Response) return target;
  await deleteUserById(id);
  return ok(c, { deleted: true });
});
