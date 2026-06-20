import { readFileSync } from "fs";
import { resolve } from "path";

// Load DATABASE_URL from root .env before db client initialises
try {
  const env = readFileSync(resolve(__dirname, "../../../.env"), "utf-8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*["']?(.*?)["']?\s*$/);
    if (m?.[1]) { process.env["DATABASE_URL"] = m[1].trim(); break; }
  }
} catch { /* ignore — DATABASE_URL already in environment */ }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require("./client") as typeof import("./client");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sql } = require("drizzle-orm") as typeof import("drizzle-orm");

/**
 * Idempotent DDL for the `screen` table. Applied directly (instead of
 * drizzle-kit generate) because the drizzle snapshot is mid-rename
 * (project → experience) and its interactive resolver can't run headless.
 */
async function migrate() {
  console.log("Creating screen table (if not exists)...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "screen" (
      "screen_id" text PRIMARY KEY NOT NULL,
      "screen_name" text NOT NULL,
      "current_experience_id" text,
      "position" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "deleted_at" timestamp with time zone
    )
  `);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "screen"
        ADD CONSTRAINT "screen_current_experience_id_experience_id_fk"
        FOREIGN KEY ("current_experience_id") REFERENCES "experience"("id") ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "screen_current_experience_idx" ON "screen" ("current_experience_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "screen_deleted_at_idx" ON "screen" ("deleted_at")`);
  console.log("  ✓ screen table ready");
}

migrate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
