import { serve } from "@hono/node-server"
import { WebSocketServer } from "ws"

import { app } from "./app"
import { env } from "./env"
import { pool } from "./lib/db"
import { storage } from "./lib/storage"
import { startReaper } from "./services/reaper"

// Client messages are tiny control frames; refuse anything large at the socket.
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })

const server = serve({ fetch: app.fetch, port: env.PORT, websocket: { server: wss } }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`)
  if (!storage) console.warn("[api] R2_* is not set — uploads and media playback are disabled")
})

startReaper()

function shutdown(signal: string) {
  console.log(`[api] ${signal} — shutting down`)
  server.close(() => {
    void pool.end().finally(() => process.exit(0))
  })
  // Never hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
