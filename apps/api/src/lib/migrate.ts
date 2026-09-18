import { migrate } from "drizzle-orm/node-postgres/migrator"

import { env } from "../env"
import { db } from "./db"

/**
 * Applies pending migrations before the server accepts traffic — only when
 * MIGRATIONS_DIR is set, which the production image does. In development run
 * `pnpm db:migrate` instead, so a code change never migrates a database by
 * surprise. Migrations run in a transaction and are recorded, so re-running on
 * every boot is a no-op once applied.
 */
export async function runMigrations(): Promise<void> {
  if (!env.MIGRATIONS_DIR) return
  const started = Date.now()
  await migrate(db, { migrationsFolder: env.MIGRATIONS_DIR })
  console.log(`[api] database migrations up to date (${Date.now() - started} ms)`)
}
