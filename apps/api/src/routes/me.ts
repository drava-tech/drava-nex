import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.js";

type SessionUser = { id: string; name: string; email: string; role: string };

// GET /api/me — current session user (shape kept: { user }).
export const meRouter = new Hono();

meRouter.get("/", requireAuth, async (c) => {
  const user = c.get("user" as never) as SessionUser;
  return c.json({ user });
});
