import { Hono } from "hono";
import { db, user } from "@platform/db";
import { eq, count, inArray } from "@platform/db";
import { auth } from "../lib/auth.js";

export const setupRouter = new Hono();

// POST /api/auth/setup — create first admin when none exists
setupRouter.post("/", async (c) => {
  try {
    const rows = await db
      .select({ adminCount: count() })
      .from(user)
      .where(inArray(user.role, ["ADMIN", "SUPERADMIN"]));

    const adminCount = rows[0]?.adminCount ?? 0;
    if (Number(adminCount) > 0) {
      return c.json({ error: "An admin already exists. Contact your administrator." }, 403);
    }

    const body = await c.req.json<{ email?: string; password?: string; name?: string }>();
    const { email, password, name } = body;

    if (!email || !password || !name) {
      return c.json({ error: "email, password, and name are required." }, 400);
    }
    if (password.length < 8) {
      return c.json({ error: "Password must be at least 8 characters." }, 400);
    }

    const result = await auth.api.signUpEmail({ body: { email, password, name } });
    if (!result?.user) return c.json({ error: "Failed to create user." }, 500);

    await db.update(user).set({ role: "ADMIN" }).where(eq(user.id, result.user.id));

    return c.json({ message: "First admin created successfully.", userId: result.user.id });
  } catch (err) {
    console.error("[setup] error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});
