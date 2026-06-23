import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth.js";

/**
 * First-class media library asset. Backs the media library (replaces the old
 * public/media/metadata.json sidecar) and is the thing a screen points at when
 * it displays a raw video/image (see screen.currentMediaAssetId).
 */
export const mediaAsset = pgTable(
  "media_asset",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    // 'image' | 'video' | 'document' (kept as text so new kinds don't need an enum migration).
    type: text("type").notNull(),
    // Public URL/path the player loads ("/media/<file>" for local uploads, or an absolute http URL).
    url: text("url").notNull(),
    // Display name (typically the original filename).
    name: text("name").notNull(),
    sizeBytes: integer("size_bytes"),
    uploadedByUserId: text("uploaded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("media_asset_type_idx").on(table.type),
    index("media_asset_deleted_at_idx").on(table.deletedAt),
  ]
);

export type MediaAsset = typeof mediaAsset.$inferSelect;
export type NewMediaAsset = typeof mediaAsset.$inferInsert;
