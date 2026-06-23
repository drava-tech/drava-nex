import { readFileSync, existsSync } from "fs";
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
 * Idempotent migration for first-class media assets + the screen content
 * reference. Applied directly (instead of drizzle-kit) because the drizzle
 * snapshot is mid-rename and its interactive resolver can't run headless —
 * same approach as migrate-screen.ts.
 *
 * Run once: `pnpm --filter @platform/db db:migrate-media`
 */

async function ddl() {
  console.log("1/4 Schema: media_asset table + screen content-ref columns...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "media_asset" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
      "type" text NOT NULL,
      "url" text NOT NULL,
      "name" text NOT NULL,
      "size_bytes" integer,
      "uploaded_by_user_id" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "deleted_at" timestamp with time zone
    )
  `);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "media_asset"
        ADD CONSTRAINT "media_asset_uploaded_by_user_id_user_id_fk"
        FOREIGN KEY ("uploaded_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "media_asset_type_idx" ON "media_asset" ("type")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "media_asset_deleted_at_idx" ON "media_asset" ("deleted_at")`);

  await db.execute(sql`ALTER TABLE "screen" ADD COLUMN IF NOT EXISTS "current_content_kind" text`);
  await db.execute(sql`ALTER TABLE "screen" ADD COLUMN IF NOT EXISTS "current_media_asset_id" text`);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "screen"
        ADD CONSTRAINT "screen_current_media_asset_id_media_asset_id_fk"
        FOREIGN KEY ("current_media_asset_id") REFERENCES "media_asset"("id") ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "screen_current_media_asset_idx" ON "screen" ("current_media_asset_id")`);

  // Existing experience assignments → kind 'experience' (media ones get fixed below).
  await db.execute(sql`
    UPDATE "screen" SET "current_content_kind" = 'experience'
    WHERE "current_experience_id" IS NOT NULL AND "current_content_kind" IS NULL
  `);
  console.log("  ✓ schema ready");
}

/** Insert a media_asset for url/type/name if one doesn't already exist; return its id. */
async function ensureMediaAsset(url: string, type: string, name: string): Promise<string> {
  const found = await db.execute(
    sql`SELECT id FROM "media_asset" WHERE url = ${url} AND deleted_at IS NULL LIMIT 1`
  );
  const existingId = (found.rows?.[0] as { id: string } | undefined)?.id;
  if (existingId) return existingId;
  const inserted = await db.execute(
    sql`INSERT INTO "media_asset" (type, url, name) VALUES (${type}, ${url}, ${name}) RETURNING id`
  );
  return (inserted.rows[0] as { id: string }).id;
}

async function importLibrary() {
  console.log("2/4 Importing existing media library (metadata.json)...");
  const metaPath = resolve(__dirname, "../../../apps/cms/public/media/metadata.json");
  if (!existsSync(metaPath)) {
    console.log("  • no metadata.json — skipping");
    return;
  }
  let items: Array<{ name: string; type: string; url: string }> = [];
  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf-8"));
    if (Array.isArray(parsed)) items = parsed;
  } catch { /* malformed — skip */ }

  let imported = 0;
  for (const item of items) {
    if (!item?.url || !item?.type) continue;
    const before = await db.execute(
      sql`SELECT id FROM "media_asset" WHERE url = ${item.url} AND deleted_at IS NULL LIMIT 1`
    );
    if (before.rows?.[0]) continue;
    await ensureMediaAsset(item.url, item.type, item.name ?? item.url);
    imported++;
  }
  console.log(`  ✓ imported ${imported} asset(s) (of ${items.length})`);
}

async function convertPlaceholders() {
  console.log("3/4 Converting [MEDIA:*] placeholder experiences → media assets...");
  const placeholders = await db.execute(sql`
    SELECT id, name FROM "experience"
    WHERE deleted_at IS NULL AND name LIKE '[MEDIA:%'
  `);

  let converted = 0;
  for (const row of placeholders.rows as Array<{ id: string; name: string }>) {
    const m = row.name.match(/^\[MEDIA:(video|image)\]\s+(.*)$/);
    if (!m) continue;
    const type = m[1]!;
    const raw = m[2]!;
    const url = raw.startsWith("http") ? raw : `/media/${raw}`;
    const name = raw.startsWith("http") ? raw.split("/").pop()?.split("?")[0] ?? raw : raw;

    const assetId = await ensureMediaAsset(url, type, name);

    // Repoint every screen using this placeholder to the media asset.
    await db.execute(sql`
      UPDATE "screen"
      SET current_content_kind = 'media',
          current_media_asset_id = ${assetId},
          current_experience_id = NULL,
          updated_at = now()
      WHERE current_experience_id = ${row.id}
    `);

    // Retire the placeholder experience.
    await db.execute(sql`
      UPDATE "experience" SET deleted_at = now(), updated_at = now() WHERE id = ${row.id}
    `);
    converted++;
  }
  console.log(`  ✓ converted ${converted} placeholder(s)`);
}

async function run() {
  await ddl();
  await importLibrary();
  await convertPlaceholders();
  console.log("4/4 Done.");
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
