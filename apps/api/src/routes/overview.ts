import { Hono } from "hono"
import { overviewRepo } from "@workspace/db"
import type { Overview } from "@workspace/types"

import type { AppEnv } from "../lib/app-env"
import { db } from "../lib/db"
import { ok } from "../lib/response"
import { requireUser } from "../middleware/auth"
import { connectedScreenIds } from "../realtime/gateway"

const overview = overviewRepo(db)

export const overviewRouter = new Hono<AppEnv>().get("/", requireUser, async (c) => {
  const [screens, media, recent] = await Promise.all([
    overview.screenCounts(),
    overview.mediaStats(),
    overview.recentPushes(10),
  ])
  return ok(c, {
    screens: { ...screens, online: connectedScreenIds().length },
    media,
    recent: recent.map((r) => ({ ...r, at: r.at.toISOString() })),
  } satisfies Overview)
})
