import { Hono } from "hono"
import { createScreenRequestSchema, renameScreenRequestSchema, type ScreenDetail } from "@workspace/types"

import type { AppEnv } from "../lib/app-env"
import { fail, ok } from "../lib/response"
import { parseJson } from "../lib/validate"
import { requireAdmin, requireUser } from "../middleware/auth"
import { resolveScreenContent } from "../services/content"
import { notifyAdmins, notifyScreenRevoked } from "../services/events"
import { media, toMediaDto } from "../services/media"
import { newScreenId, screens, toScreenDto } from "../services/screens"

export const screensRouter = new Hono<AppEnv>()

screensRouter.get("/", requireUser, async (c) => {
  const rows = await screens.list()
  return ok(c, rows.map(toScreenDto))
})

screensRouter.get("/:id", requireUser, async (c) => {
  const row = await screens.get(c.req.param("id"))
  if (!row) return fail(c, "NOT_FOUND", "Screen not found", 404)
  const ids = [row.currentMediaId, row.defaultMediaId, ...row.queueMediaIds].filter((x): x is string => Boolean(x))
  const rows = new Map((await media.getMany([...new Set(ids)])).map((m) => [m.id, toMediaDto(m)]))
  return ok(c, {
    ...toScreenDto(row),
    content: await resolveScreenContent(row.id),
    current: (row.currentMediaId && rows.get(row.currentMediaId)) || null,
    default: (row.defaultMediaId && rows.get(row.defaultMediaId)) || null,
    queue: row.queueMediaIds.flatMap((id) => rows.get(id) ?? []),
  } satisfies ScreenDetail)
})

screensRouter.post("/", requireAdmin, async (c) => {
  const body = await parseJson(c, createScreenRequestSchema)
  if (!body.ok) return body.response
  const row = await screens.create({ id: newScreenId(), name: body.data.name })
  notifyAdmins({ type: "SCREENS_CHANGED" })
  return ok(c, toScreenDto(row), 201)
})

screensRouter.patch("/:id", requireAdmin, async (c) => {
  const body = await parseJson(c, renameScreenRequestSchema)
  if (!body.ok) return body.response
  const row = await screens.rename(c.req.param("id"), body.data.name)
  if (!row) return fail(c, "NOT_FOUND", "Screen not found", 404)
  notifyAdmins({ type: "SCREENS_CHANGED" })
  return ok(c, toScreenDto(row))
})

screensRouter.delete("/:id", requireAdmin, async (c) => {
  const deleted = await screens.softDelete(c.req.param("id"))
  if (!deleted) return fail(c, "NOT_FOUND", "Screen not found", 404)
  notifyScreenRevoked(c.req.param("id"))
  notifyAdmins({ type: "SCREENS_CHANGED" })
  return ok(c, { deleted: true })
})
