import { serve } from "@hono/node-server"

import { app } from "./app"
import { env } from "./env"
import { pool } from "./lib/db"

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`)
})

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
