import { createMiddleware } from "hono/factory"
import type { ScreenRow } from "@workspace/db"

import { bearerToken, hashDeviceToken } from "../lib/device-token"
import { fail } from "../lib/response"
import { pairing } from "../services/pairing"

export type DeviceEnv = { Variables: { screen: ScreenRow } }

/**
 * Authenticates a paired display by its bearer token. There is no session and
 * no cookie — displays run unattended and never sign in.
 */
export const requireDevice = createMiddleware<DeviceEnv>(async (c, next) => {
  const token = bearerToken(c.req.header("authorization"))
  if (!token) return fail(c, "UNAUTHORIZED", "Device token required", 401)
  const screen = await pairing.findScreenByTokenHash(hashDeviceToken(token))
  if (!screen) return fail(c, "UNAUTHORIZED", "This display is not paired", 401)
  c.set("screen", screen)
  await next()
})
