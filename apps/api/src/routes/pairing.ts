import { Hono } from "hono"
import { pairRequestSchema, type PairingCodeResponse, type PairResponse } from "@workspace/types"

import type { AppEnv } from "../lib/app-env"
import { hashDeviceToken, newDeviceToken, newPairingCode } from "../lib/device-token"
import { rateLimit } from "../lib/rate-limit"
import { fail, ok } from "../lib/response"
import { parseJson } from "../lib/validate"
import { requireAdmin } from "../middleware/auth"
import { requireDevice, type DeviceEnv } from "../middleware/device"
import { notifyAdmins } from "../services/events"
import { PAIRING_CODE_TTL_MS, pairing } from "../services/pairing"
import { screens } from "../services/screens"

// ─── Console side (admins) — mounted under /api/screens ─────────────────────

export const screenPairingRouter = new Hono<AppEnv>()

screenPairingRouter.post("/:id/pairing-code", requireAdmin, async (c) => {
  const screen = await screens.get(c.req.param("id"))
  if (!screen) return fail(c, "NOT_FOUND", "Screen not found", 404)
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS)
  // A collision with a live code is astronomically unlikely; retry anyway.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newPairingCode()
    try {
      await pairing.issue(screen.id, code, expiresAt)
      return ok(c, { code, expiresAt: expiresAt.toISOString() } satisfies PairingCodeResponse, 201)
    } catch (err) {
      if ((err as { code?: string }).code !== "23505") throw err // unique_violation
    }
  }
  return fail(c, "INTERNAL", "Could not generate a code — try again", 500)
})

screenPairingRouter.delete("/:id/pairing", requireAdmin, async (c) => {
  const done = await pairing.unpair(c.req.param("id"))
  if (!done) return fail(c, "NOT_FOUND", "Screen not found", 404)
  notifyAdmins({ type: "SCREENS_CHANGED" })
  return ok(c, { unpaired: true })
})

// ─── Device side (public) — mounted at /api/pair and /api/device ────────────

export const pairRouter = new Hono()

// The one public, unauthenticated write. 10 attempts per minute per IP makes
// spraying the pool of live codes impractical.
pairRouter.post("/", rateLimit({ name: "pair", limit: 10, windowMs: 60_000 }), async (c) => {
  const body = await parseJson(c, pairRequestSchema)
  if (!body.ok) return body.response
  const token = newDeviceToken()
  const screen = await pairing.claim(body.data.code, hashDeviceToken(token))
  if (!screen) return fail(c, "NOT_FOUND", "That code is wrong or has expired", 404)
  notifyAdmins({ type: "SCREENS_CHANGED" })
  return ok(c, { screenId: screen.id, name: screen.name, token } satisfies PairResponse, 201)
})

export const deviceRouter = new Hono<DeviceEnv>()

/** Lets a display confirm its stored token still works (or learn it was revoked). */
deviceRouter.get("/me", requireDevice, (c) => {
  const screen = c.get("screen")
  return ok(c, { screenId: screen.id, name: screen.name })
})
