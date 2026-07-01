import { Hono } from "hono";
import { z } from "zod";
import { getUserById, setUserRole, deleteUserById } from "@platform/db";
import { requireAdmin, type SessionUser } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { auth } from "../lib/auth.js";

export const usersRouter = new Hono();
usersRouter.use("*", requireAdmin);

// email format is validated by Better Auth on sign-up; keep the schema permissive.
const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "GUEST"]),
});

// POST /api/users — create a user (optionally promote to ADMIN)
usersRouter.post("/", async (c) => {
  let body;
  try {
    body = createSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }

  const result = await auth.api.signUpEmail({
    body: { email: body.email, password: body.password, name: body.name },
  });
  if (!result?.user) return fail(c, "INTERNAL", "Failed to create user.", 500);

  if (body.role === "ADMIN") {
    await setUserRole(result.user.id, "ADMIN");
  }
  return ok(c, { id: result.user.id }, 201);
});

// DELETE /api/users/:id — delete a user (with self/superadmin guards)
usersRouter.delete("/:id", async (c) => {
  const targetId = c.req.param("id") ?? "";
  const currentUser = c.get("user" as never) as SessionUser | undefined;
  if (currentUser?.id === targetId) {
    return fail(c, "FORBIDDEN", "You cannot delete your own account.", 403);
  }
  const target = await getUserById(targetId);
  if (target?.role === "SUPERADMIN") {
    return fail(c, "FORBIDDEN", "The super admin account cannot be deleted.", 403);
  }
  await deleteUserById(targetId);
  return ok(c, { deleted: true });
});
