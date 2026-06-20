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

// These imports must come AFTER the env block when tsx compiles as CJS
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require("./client") as typeof import("./client");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sql } = require("drizzle-orm") as typeof import("drizzle-orm");

// Migrated from the old screens.json (main-screen → "Human Aping").
const TARGET_EXPERIENCE = "dcc005f3-0726-4e0e-b48c-0cbc6a7a5af8";

async function seed() {
  console.log("Seeding screen rows into screen table...");

  // Only set the FK if that experience still exists, else leave unassigned.
  const res = await db.execute(
    sql`SELECT id FROM "experience" WHERE id = ${TARGET_EXPERIENCE} AND deleted_at IS NULL`
  );
  const hasExp = ((res as { rows?: unknown[] }).rows?.length ?? 0) > 0;
  const expValue = hasExp ? TARGET_EXPERIENCE : null;

  await db.execute(sql`
    INSERT INTO "screen" (screen_id, screen_name, current_experience_id)
    VALUES ('main-screen', 'tv-86inch', ${expValue})
    ON CONFLICT (screen_id) DO UPDATE SET
      screen_name           = EXCLUDED.screen_name,
      current_experience_id = EXCLUDED.current_experience_id,
      deleted_at            = NULL,
      updated_at            = NOW()
  `);

  console.log(`  ✓ main-screen (experience: ${expValue ?? "none — assign one in the CMS"})`);
  console.log("\nDone. Screens are in the screen table.");
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
