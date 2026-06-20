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

async function run() {
  const type = "video";
  const filename = "4k_render_intro_animation_0003.mp4";
  const mediaName = `[MEDIA:${type}] ${filename}`;
  const mediaSlug = `media-${type}-${filename.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`;

  console.log(`Assigning ${filename} to main-screen...`);

  // 1. Insert/update experience
  const expRes = await db.execute(sql`
    INSERT INTO "experience" (name, slug)
    VALUES (${mediaName}, ${mediaSlug})
    ON CONFLICT (slug) WHERE deleted_at IS NULL
    DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
    RETURNING id
  `);

  const expId = (expRes.rows?.[0] as { id: string })?.id;
  if (!expId) {
    throw new Error("Failed to get experience ID");
  }

  // 2. Assign to main-screen
  await db.execute(sql`
    INSERT INTO "screen" (screen_id, screen_name, current_experience_id)
    VALUES ('main-screen', 'tv-86inch', ${expId})
    ON CONFLICT (screen_id) DO UPDATE SET
      current_experience_id = EXCLUDED.current_experience_id,
      updated_at = NOW()
  `);

  console.log(`✓ Successfully assigned video experience "${mediaName}" (ID: ${expId}) to 'main-screen'.`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
