import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"

import * as schema from "./schema"

/**
 * Builds the database handle. Takes the URL as an argument instead of reading
 * process.env at import time — the API validates its environment first and
 * then connects, so a missing variable fails loudly at boot, not mid-request.
 */
export function createDb(connectionString: string, options: { max?: number } = {}) {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 })
  const db = drizzle({ client: pool, schema })
  return { db, pool }
}

export type Database = ReturnType<typeof createDb>["db"]
