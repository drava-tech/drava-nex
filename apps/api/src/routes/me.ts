import { Hono } from "hono"

import type { AppEnv } from "../lib/app-env"
import { ok } from "../lib/response"
import { requireUser } from "../middleware/auth"

export const meRouter = new Hono<AppEnv>().get("/", requireUser, (c) => {
  const { id, name, email, image, role } = c.get("user")
  return ok(c, { id, name, email, image: image ?? null, role })
})
