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

const verticals = [
  { name: "Experience Center",       slug: "experience-center",      position: 0 },
  { name: "Architecture & Interiors", slug: "architecture-interiors", position: 1 },
  { name: "Brand Solutions",          slug: "brand-solutions",        position: 2 },
];

async function seed() {
  console.log("Seeding portfolio verticals into experience table...");
  for (const v of verticals) {
    await db.execute(sql`
      INSERT INTO "experience" (name, slug, position)
      VALUES (${v.name}, ${v.slug}, ${v.position})
      ON CONFLICT (slug) WHERE deleted_at IS NULL
      DO UPDATE SET
        name       = EXCLUDED.name,
        position   = EXCLUDED.position,
        updated_at = NOW()
    `);
    console.log(`  ✓ ${v.name}`);
  }
  console.log("\nDone. Portfolio verticals are in the experience table.");
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
