/**
 * @platform/db — Database Client
 *
 * PLACEHOLDER: PostgreSQL is not yet configured.
 *
 * When ready:
 *  1. Set DATABASE_URL in your .env file
 *  2. Remove the TODO comment below
 *  3. Run `pnpm --filter @platform/db db:generate` to generate migrations
 *  4. Run `pnpm --filter @platform/db db:migrate` to apply migrations
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

// TODO: Replace with your actual DATABASE_URL before running any DB operations.
// Example: "postgresql://user:password@localhost:5432/cms_platform"
const DATABASE_URL = process.env["DATABASE_URL"] ?? "";

/**
 * Connection pool — shared across all queries in the process.
 * Max connections tuned for a medium-load API server.
 */
export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

/**
 * Drizzle ORM client — use this everywhere in your app.
 *
 * @example
 * import { db } from '@platform/db';
 * const screens = await db.query.screens.findMany();
 */
export const db = drizzle(pool, { schema });

export type Database = typeof db;
