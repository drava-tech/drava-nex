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
  {
    name: "Experience Center",
    slug: "experience-center",
    status: "ACTIVE",
    thumbnailUrl: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=650&q=80",
    videoUrl: "/experience_intro.mp4",
  },
  {
    name: "Architecture & Interiors",
    slug: "architecture-interiors",
    status: "ACTIVE",
    thumbnailUrl: "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=650&q=80",
    videoUrl: "/tusker_presentation.mov",
  },
  {
    name: "Brand Solutions",
    slug: "brand-solutions",
    status: "ACTIVE",
    thumbnailUrl: "https://images.unsplash.com/photo-1558655146-9f40138edfeb?auto=format&fit=crop&w=650&q=80",
    videoUrl: "/brand_solutions_loop.webm",
  },
];

async function seed() {
  console.log("Seeding portfolio verticals into project table...");
  for (const v of verticals) {
    await db.execute(sql`
      INSERT INTO "project" (name, slug, status, thumbnail_url, video_url, settings_json)
      VALUES (${v.name}, ${v.slug}, ${v.status}, ${v.thumbnailUrl}, ${v.videoUrl}, '{}'::jsonb)
      ON CONFLICT (slug) WHERE deleted_at IS NULL
      DO UPDATE SET
        video_url     = EXCLUDED.video_url,
        thumbnail_url = EXCLUDED.thumbnail_url,
        updated_at    = NOW()
    `);
    console.log(`  ✓ ${v.name}`);
  }
  console.log("\nDone. Portfolio verticals are in the project table.");
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
