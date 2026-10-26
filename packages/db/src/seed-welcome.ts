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

// The greeting feature (apps/api/src/services/greeting) pushes the experience
// with this slug onto main-screen. Keep in sync with WELCOME_EXPERIENCE_SLUG in
// apps/api/src/services/door-screen-trigger.ts.
const SLUG = "welcome-screen";
// Same text as DEFAULT_WELCOME_CONTENT in packages/ui/src/templates/welcome/content.ts
// (this package can't import @platform/ui).
const WELCOME_CONTENT = { title: "Welcome to Tusker Digital Experience Center", subtitle: "" };

async function seed() {
  console.log("Seeding the welcome-screen experience…");

  const existing = await db.execute<{ id: string }>(
    sql`SELECT id FROM "experience" WHERE slug = ${SLUG} AND deleted_at IS NULL LIMIT 1`
  );
  if (existing.rows.length > 0) {
    console.log(`  ✓ "${SLUG}" already exists (left untouched)`);
    return;
  }

  const admins = await db.execute<{ id: string }>(
    sql`SELECT id FROM "user" WHERE role IN ('ADMIN', 'SUPERADMIN') ORDER BY created_at ASC LIMIT 1`
  );
  const adminId = admins.rows[0]?.id;
  if (!adminId) {
    throw new Error(
      "No ADMIN or SUPERADMIN user found — sign in to the CMS once (or create an admin) and re-run db:seed-welcome."
    );
  }

  await db.execute(sql`
    INSERT INTO "experience" (name, slug, template_key, template_content, created_by_user_id, updated_by_user_id)
    VALUES (
      'Welcome Screen',
      ${SLUG},
      'welcome',
      ${JSON.stringify({ welcome: WELCOME_CONTENT })}::jsonb,
      ${adminId},
      ${adminId}
    )
  `);

  console.log(`  ✓ created "${SLUG}" (template: welcome)`);
}

seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
