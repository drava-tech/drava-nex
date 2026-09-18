import { sql } from "drizzle-orm"
import { Hono } from "hono"

import { db } from "../lib/db"

export const healthRouter = new Hono().get("/", async (c) => {
  try {
    await db.execute(sql`select 1`)
    return c.json({ status: "ok", db: "ok" })
  } catch {
    return c.json({ status: "degraded", db: "unreachable" }, 503)
  }
})
