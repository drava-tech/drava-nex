import type { Context } from "hono"
import { createMiddleware } from "hono/factory"
import { getConnInfo } from "@hono/node-server/conninfo"

import { fail } from "./response"

/**
 * The client's IP. Behind our nginx the socket peer is nginx itself, so the
 * address nginx records in X-Real-IP is used — nginx overwrites that header,
 * so a client cannot spoof it. Without a proxy (dev) the socket address is used.
 */
export function clientIp(c: Context): string {
  return c.req.header("x-real-ip") ?? getConnInfo(c).remote.address ?? "unknown"
}

/**
 * Fixed-window, in-memory limiter. Enough for one API process guarding a
 * handful of public endpoints; it resets on restart, which is acceptable here.
 */
export function rateLimit(opts: { limit: number; windowMs: number; name: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, v] of hits) if (v.resetAt <= now) hits.delete(key)
  }, opts.windowMs)
  sweep.unref()

  return createMiddleware(async (c, next) => {
    const key = clientIp(c)
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs })
    } else if (++entry.count > opts.limit) {
      c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)))
      console.warn(`[rate-limit] ${opts.name}: ${key} over ${opts.limit}/${opts.windowMs}ms`)
      return fail(c, "RATE_LIMITED", "Too many attempts — wait a minute and try again", 429)
    }
    await next()
  })
}
