import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { contents } from "./contents.js";

// ─── Enum ─────────────────────────────────────────────────────────────────────

export const assetTypeEnum = pgEnum("asset_type", [
  "image",
  "video",
  "pdf",
  "stream",
]);

// ─── Table ────────────────────────────────────────────────────────────────────

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    type: assetTypeEnum("type").notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    /**
     * Optional metadata for the asset.
     * Example: { "width": 1920, "height": 1080, "duration": 120, "mimeType": "video/mp4" }
     */
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("assets_content_id_idx").on(table.contentId),
    index("assets_type_idx").on(table.type),
  ]
);

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
