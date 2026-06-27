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

const product = {
  name: "Smart Glasses",
  slug: "smart-glasses",
  sku: "SG-001",
  detectionLabel: "smart_glasses",
  category: "Wearable Technology",
  brand: "White Tusker",
  shortDescription:
    "Wearable smart glasses designed for live streaming and interactive experiences.",
  status: "ACTIVE",
};

const features = [
  { title: "Live video streaming", description: "Streams live video through WebSocket." },
  { title: "Hands-free operation", description: null },
  { title: "Wi-Fi connectivity", description: null },
  { title: "Voice interaction support", description: null },
];

const specifications = [
  { group: "Connectivity", label: "Network", value: "Wi-Fi" },
  { group: "Connectivity", label: "Streaming Protocol", value: "WebSocket" },
  { group: "Usage", label: "Mode", value: "Hands-free" },
  { group: "Usage", label: "Application", value: "Interactive Experience Centre" },
];

async function seed() {
  console.log("Seeding sample product: Smart Glasses…");

  // Idempotent upsert keyed on the partial-unique slug index.
  const res = await db.execute<{ id: string }>(sql`
    INSERT INTO "product"
      (name, slug, sku, detection_label, category, brand, short_description, status)
    VALUES (
      ${product.name}, ${product.slug}, ${product.sku}, ${product.detectionLabel},
      ${product.category}, ${product.brand}, ${product.shortDescription}, ${product.status}
    )
    ON CONFLICT (slug) WHERE deleted_at IS NULL
    DO UPDATE SET
      sku               = EXCLUDED.sku,
      detection_label   = EXCLUDED.detection_label,
      category          = EXCLUDED.category,
      brand             = EXCLUDED.brand,
      short_description = EXCLUDED.short_description,
      status            = EXCLUDED.status,
      updated_at        = NOW()
    RETURNING id
  `);

  const productId = res.rows[0]?.id;
  if (!productId) throw new Error("Failed to upsert product");
  console.log(`  ✓ product ${productId}`);

  // Re-seed children cleanly so the script is fully idempotent. No media is
  // attached — pick images/video from the CMS media library in the admin UI.
  await db.execute(sql`DELETE FROM "product_feature" WHERE product_id = ${productId}`);
  await db.execute(sql`DELETE FROM "product_specification" WHERE product_id = ${productId}`);

  for (const [i, f] of features.entries()) {
    await db.execute(sql`
      INSERT INTO "product_feature" (product_id, title, description, sort_order)
      VALUES (${productId}, ${f.title}, ${f.description}, ${i})
    `);
  }
  console.log(`  ✓ ${features.length} features`);

  for (const [i, s] of specifications.entries()) {
    await db.execute(sql`
      INSERT INTO "product_specification" (product_id, group_name, label, value, sort_order)
      VALUES (${productId}, ${s.group}, ${s.label}, ${s.value}, ${i})
    `);
  }
  console.log(`  ✓ ${specifications.length} specifications`);

  console.log("\nDone. Smart Glasses is seeded (status ACTIVE, no media).");
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
