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

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

// Load DATABASE_URL from root .env if not already defined in process.env
let DATABASE_URL = process.env["DATABASE_URL"] ?? "";

if (!DATABASE_URL) {
  try {
    let currentDir = process.cwd();
    // Traverse up from process.cwd() to find first .env containing DATABASE_URL
    while (true) {
      const checkPath = resolve(currentDir, ".env");
      if (existsSync(checkPath)) {
        const envContent = readFileSync(checkPath, "utf-8");
        for (const line of envContent.split(/\r?\n/)) {
          const match = line.match(/^\s*DATABASE_URL\s*=\s*["']?(.*?)["']?\s*$/);
          if (match && match[1]) {
            DATABASE_URL = match[1].trim();
            process.env["DATABASE_URL"] = DATABASE_URL;
            break;
          }
        }
        if (DATABASE_URL) break;
      }
      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }

    if (!DATABASE_URL) {
      // Fallback to relative to __dirname
      const fallbackPath = resolve(__dirname, "../../../.env");
      if (existsSync(fallbackPath)) {
        const envContent = readFileSync(fallbackPath, "utf-8");
        for (const line of envContent.split(/\r?\n/)) {
          const match = line.match(/^\s*DATABASE_URL\s*=\s*["']?(.*?)["']?\s*$/);
          if (match && match[1]) {
            DATABASE_URL = match[1].trim();
            process.env["DATABASE_URL"] = DATABASE_URL;
            break;
          }
        }
      }
    }
  } catch (e) {
    // Ignore if error
  }
}

console.log("[@platform/db] DATABASE_URL during initialization:", DATABASE_URL ? DATABASE_URL.replace(/:[^:@]+@/, ":****@") : "empty/undefined");


// Prevent multiple instances of pg Pool in development
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const poolConfig = {
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

export const pool = globalThis.pgPool ?? new Pool(poolConfig);

if (process.env.NODE_ENV !== "production") {
  globalThis.pgPool = pool;
}

/**
 * Drizzle ORM client — use this everywhere in your app.
 *
 * @example
 * import { db } from '@platform/db';
 * const screens = await db.query.screens.findMany();
 */
export const db = drizzle(pool, { schema });

export type Database = typeof db;

export async function checkDatabaseHealth(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}
