import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalDatabaseUrl, LOCAL_DEV_DATABASE, THROWAWAY_DB_PREFIX, withDatabase } from "./guard.js";

/**
 * Creates a THROWAWAY database on the local Docker Postgres, never touching
 * cms_db_local's data:
 *
 *   1. clone the SCHEMA ONLY of cms_db_local (pg_dump -s, inside the container)
 *   2. apply 0039-0041 on top (all idempotent — so this also tests re-running them)
 *   3. point DATABASE_URL at it for the test workers
 *   4. drop it afterwards
 *
 * Why a schema clone and not `drizzle migrate`: the committed migrations cannot
 * build an empty database (a product migration references media_asset, which only
 * the one-off migrate-*.ts scripts create). The real databases got their base
 * schema the same out-of-band way, so a clone is the faithful starting point — and
 * adding the new migrations on top is exactly what a rollout does.
 *
 * Opt-in: `pnpm test:integration`. Needs the local Docker stack (platform-postgres).
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
// `pg` is the db package's dependency, not the api's.
const requireFromDb = createRequire(join(repoRoot, "packages/db/package.json"));

const composePath = join(repoRoot, "infra/docker/docker-compose.local.yml");
const compose = existsSync(composePath) ? readFileSync(composePath, "utf8") : "";
const fromCompose = (key: string) => compose.match(new RegExp(`${key}:\\s*["']?([^"'\\r\\n#]+)`))?.[1]?.trim();

/** IT_DATABASE_URL if given; else the credentials in the local compose file (also localhost-only). */
function baseUrl(): string {
  if (process.env["IT_DATABASE_URL"]) return process.env["IT_DATABASE_URL"];
  const user = fromCompose("POSTGRES_USER");
  const password = fromCompose("POSTGRES_PASSWORD");
  if (!user || !password) return ""; // the guard will explain
  return `postgresql://${user}:${encodeURIComponent(password)}@localhost:5433/${LOCAL_DEV_DATABASE}`;
}

/** Run a docker command; throw with a useful message if docker or the container isn't there. */
function docker(args: string[], input?: string): string {
  const r = spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    throw new Error(
      `docker ${args.slice(0, 3).join(" ")} failed: ${r.error?.message ?? r.stderr?.trim() ?? "unknown error"}. ` +
        `The integration suite needs Docker running with the local stack (pnpm infra:up).`
    );
  }
  return r.stdout;
}

export default async function setup(): Promise<() => Promise<void>> {
  // 1. The gate. Nothing below runs unless this is the local Docker database.
  const base = assertLocalDatabaseUrl(baseUrl());
  if (base.database !== LOCAL_DEV_DATABASE) {
    throw new Error(`Integration setup clones ${LOCAL_DEV_DATABASE}; IT_DATABASE_URL must name it (got "${base.database}").`);
  }

  const container = process.env["IT_PG_CONTAINER"] ?? "platform-postgres";
  const dbUser = decodeURIComponent(new URL(base.url).username) || "cms_dev";

  const { Client, Pool } = requireFromDb("pg") as typeof import("pg");
  const name = `${THROWAWAY_DB_PREFIX}${process.pid}_${randomBytes(3).toString("hex")}`;
  const admin = new Client({ connectionString: withDatabase(base.url, "postgres"), connectionTimeoutMillis: 4000 });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `Cannot reach the local Postgres on 127.0.0.1:5433 (${(err as Error).message}). ` +
        `Start Docker and the local stack (pnpm infra:up), then retry.`
    );
  }

  const testUrl = withDatabase(base.url, name);
  assertLocalDatabaseUrl(testUrl, "the throwaway database URL"); // belt and braces

  await admin.query(`CREATE DATABASE "${name}"`);
  console.info(`[integration] created throwaway database ${name} on localhost:5433`);

  try {
    // 2. Clone the schema (no data) from the local dev database.
    const schema = docker(["exec", container, "pg_dump", "-U", dbUser, "-s", "--no-owner", "--no-privileges", LOCAL_DEV_DATABASE]);
    docker(["exec", "-i", container, "psql", "-U", dbUser, "-d", name, "-v", "ON_ERROR_STOP=1", "-q"], schema);

    // 3. The migrations under test, on top of that base. All use IF NOT EXISTS / idempotent guards.
    const pool = new Pool({ connectionString: testUrl });
    try {
      for (const file of ["0039_visitor_greeting.sql", "0040_visitor_greeting_skipped.sql", "0041_app_setting.sql"]) {
        const sql = readFileSync(join(repoRoot, "packages/db/drizzle", file), "utf8");
        for (const statement of sql.split("--> statement-breakpoint")) await pool.query(statement);
      }
    } finally {
      await pool.end();
    }
  } catch (err) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
    await admin.end();
    throw err;
  }

  // The test workers inherit this; @platform/db prefers it over any .env file.
  process.env["DATABASE_URL"] = testUrl;

  return async () => {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      console.info(`[integration] dropped ${name}`);
    } finally {
      await admin.end();
    }
  };
}
