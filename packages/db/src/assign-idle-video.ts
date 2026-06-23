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
  const url = `/media/${filename}`;

  console.log(`Assigning ${filename} to main-screen...`);

  // 1. Ensure a media asset exists for this file.
  const found = await db.execute(sql`
    SELECT id FROM "media_asset" WHERE url = ${url} AND deleted_at IS NULL LIMIT 1
  `);
  let assetId = (found.rows?.[0] as { id: string } | undefined)?.id;
  if (!assetId) {
    const inserted = await db.execute(sql`
      INSERT INTO "media_asset" (type, url, name) VALUES (${type}, ${url}, ${filename}) RETURNING id
    `);
    assetId = (inserted.rows[0] as { id: string }).id;
  }

  // 2. Point main-screen at the media asset (kind = 'media').
  await db.execute(sql`
    INSERT INTO "screen" (screen_id, screen_name, current_content_kind, current_media_asset_id)
    VALUES ('main-screen', 'tv-86inch', 'media', ${assetId})
    ON CONFLICT (screen_id) DO UPDATE SET
      current_content_kind = 'media',
      current_media_asset_id = EXCLUDED.current_media_asset_id,
      current_experience_id = NULL,
      updated_at = NOW()
  `);

  console.log(`✓ Assigned media "${filename}" (asset ${assetId}) to 'main-screen'.`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
