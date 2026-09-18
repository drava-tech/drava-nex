import { Hono } from "hono"
import { logger } from "hono/logger"
import { secureHeaders } from "hono/secure-headers"

import type { AppEnv } from "./lib/app-env"
import { auth } from "./lib/auth"
import { wsRoute } from "./realtime/gateway"
import { fail } from "./lib/response"
import { healthRouter } from "./routes/health"
import { mediaRouter } from "./routes/media"
import { meRouter } from "./routes/me"
import { deviceRouter, pairRouter, screenPairingRouter } from "./routes/pairing"
import { pushRouter } from "./routes/push"
import { screensRouter } from "./routes/screens"

export const app = new Hono<AppEnv>()

app.use(logger())
app.use(secureHeaders())

app.route("/health", healthRouter)

// better-auth owns everything under /api/auth (per its Hono integration doc).
// No CORS middleware: the console reaches this API same-origin (Vite proxy in
// dev, nginx in production), so no cross-site cookies are ever involved.
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))

// Displays and console tabs; see realtime/gateway.ts.
app.get("/ws", wsRoute)

app.route("/api/me", meRouter)
app.route("/api/screens", screensRouter)
app.route("/api/screens", screenPairingRouter)
app.route("/api/screens", pushRouter)
app.route("/api/pair", pairRouter)
app.route("/api/device", deviceRouter)
app.route("/api/media", mediaRouter)

app.notFound((c) => fail(c, "NOT_FOUND", "Not found", 404))

app.onError((err, c) => {
  console.error(`[api] ${c.req.method} ${c.req.path} failed:`, err)
  return fail(c, "INTERNAL", "Something went wrong", 500)
})
