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
 * Idempotent DDL: add the `template_key` column to `experience`. Applied directly
 * (instead of drizzle-kit generate) because the drizzle snapshot is mid-rename
 * (project → experience) and its interactive resolver can't run headless.
 */
async function migrate() {
  console.log("Adding experience.template_key / template_content (if not exists)...");
  await db.execute(sql`ALTER TABLE "experience" ADD COLUMN IF NOT EXISTS "template_key" text`);
  await db.execute(sql`ALTER TABLE "experience" ADD COLUMN IF NOT EXISTS "template_content" jsonb`);
  console.log("  ✓ experience.template_key + template_content ready");
}

migrate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
