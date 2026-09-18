import { Hono } from "hono"
import {
  blankRequestSchema,
  defaultMediaRequestSchema,
  navigateQueueRequestSchema,
  pushMediaRequestSchema,
  pushQueueRequestSchema,
  screenCommandRequestSchema,
  type PushResult,
} from "@workspace/types"

import type { AppEnv } from "../lib/app-env"
import { fail, ok } from "../lib/response"
import { parseJson } from "../lib/validate"
import { requireOperator } from "../middleware/auth"
import { pushContent, sendScreenCommand } from "../realtime/gateway"
import { screens } from "../services/screens"

/**
 * Everything that changes what a screen shows. Mounted under /api/screens.
 * Each route writes the database first (the source of truth), then delivers
 * via pushContent(), and answers with how many displays actually received it.
 */
export const pushRouter = new Hono<AppEnv>()

async function missingMedia(ids: string[]): Promise<string[]> {
  const found = await screens.existingMediaIds(ids)
  return ids.filter((id) => !found.has(id))
}

pushRouter.post("/:id/media", requireOperator, async (c) => {
  const body = await parseJson(c, pushMediaRequestSchema)
  if (!body.ok) return body.response
  const { mediaId } = body.data
  if (mediaId && (await missingMedia([mediaId])).length) {
    return fail(c, "NOT_FOUND", "That media item no longer exists", 404)
  }
  const row = await screens.setCurrentMedia(c.req.param("id"), mediaId)
  if (!row) return fail(c, "NOT_FOUND", "Screen not found", 404)
  await screens.logPush({ screenId: row.id, mediaId, action: mediaId ? "media" : "clear", userId: c.get("user").id })
  // A push also lifts a blank: the operator clearly wants it seen.
  sendScreenCommand(row.id, "SCREEN_UNBLANK")
  const result = await pushContent(row.id)
  return ok(c, { screenId: row.id, ...result } satisfies PushResult)
})

pushRouter.post("/:id/media-queue", requireOperator, async (c) => {
  const body = await parseJson(c, pushQueueRequestSchema)
  if (!body.ok) return body.response
  const missing = await missingMedia([...new Set(body.data.mediaIds)])
  if (missing.length) return fail(c, "NOT_FOUND", `${missing.length} item(s) no longer exist`, 404, { missing })
  const row = await screens.setQueue(c.req.param("id"), body.data.mediaIds, body.data.startIndex)
  if (!row) return fail(c, "NOT_FOUND", "Screen not found", 404)
  await screens.logPush({ screenId: row.id, mediaId: row.currentMediaId, action: "queue", userId: c.get("user").id })
  sendScreenCommand(row.id, "SCREEN_UNBLANK")
  const result = await pushContent(row.id)
  return ok(c, {
    screenId: row.id,
    ...result,
    queueIndex: row.queueIndex,
    queueLength: row.queueMediaIds.length,
  })
})

pushRouter.post("/:id/queue/navigate", requireOperator, async (c) => {
  const body = await parseJson(c, navigateQueueRequestSchema)
  if (!body.ok) return body.response
  const row = await screens.stepQueue(c.req.param("id"), body.data.direction)
  if (!row) return fail(c, "NOT_FOUND", "This screen has no queue", 404)
  await screens.logPush({ screenId: row.id, mediaId: row.currentMediaId, action: "navigate", userId: c.get("user").id })
  const result = await pushContent(row.id)
  return ok(c, {
    screenId: row.id,
    ...result,
    queueIndex: row.queueIndex,
    queueLength: row.queueMediaIds.length,
  })
})

pushRouter.post("/:id/default-media", requireOperator, async (c) => {
  const body = await parseJson(c, defaultMediaRequestSchema)
  if (!body.ok) return body.response
  const { mediaId } = body.data
  if (mediaId && (await missingMedia([mediaId])).length) {
    return fail(c, "NOT_FOUND", "That media item no longer exists", 404)
  }
  const row = await screens.setDefaultMedia(c.req.param("id"), mediaId)
  if (!row) return fail(c, "NOT_FOUND", "Screen not found", 404)
  await screens.logPush({ screenId: row.id, mediaId, action: "default", userId: c.get("user").id })
  // Takes effect live if the screen is showing its default right now.
  const result = await pushContent(row.id)
  return ok(c, { screenId: row.id, ...result } satisfies PushResult)
})

pushRouter.post("/:id/blank", requireOperator, async (c) => {
  const body = await parseJson(c, blankRequestSchema)
  if (!body.ok) return body.response
  const row = await screens.setBlanked(c.req.param("id"), body.data.blanked)
  if (!row) return fail(c, "NOT_FOUND", "Screen not found", 404)
  await screens.logPush({
    screenId: row.id,
    mediaId: null,
    action: body.data.blanked ? "blank" : "unblank",
    userId: c.get("user").id,
  })
  const players = sendScreenCommand(row.id, body.data.blanked ? "SCREEN_BLANK" : "SCREEN_UNBLANK")
  return ok(c, { screenId: row.id, blanked: row.blanked, players })
})

pushRouter.post("/:id/command", requireOperator, async (c) => {
  const body = await parseJson(c, screenCommandRequestSchema)
  if (!body.ok) return body.response
  const row = await screens.get(c.req.param("id"))
  if (!row) return fail(c, "NOT_FOUND", "Screen not found", 404)
  const players = sendScreenCommand(row.id, body.data.command)
  return ok(c, { screenId: row.id, players })
})
