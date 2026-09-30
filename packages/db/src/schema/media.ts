import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
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
    // Where this asset came from: 'upload' (POST /api/upload), 'link' (a
    // pasted URL via POST /api/media/link), or 'email' (auto-ingested from a
    // Gmail attachment — see apps/api/src/services/gmail-ingest.ts).
    // Free text like `type` above, so new sources don't need an enum migration.
    source: text("source"),
    // Populated only for source = 'email' — the originating email's sender
    // and subject, kept for display context on the Email Media page.
    emailFrom: text("email_from"),
    emailSubject: text("email_subject"),
    // True for a link pushed ad-hoc from the Browser tool before the admin has
    // chosen to keep it — hidden from the Media Library listing until saved
    // (see markMediaSaved). Screens can still be pointed at it either way;
    // this only gates library visibility, not playback.
    pendingSave: boolean("pending_save").notNull().default(false),
    // Small derived preview for grid/carousel tiles, for image assets only.
    // Null means "not generated" (a pre-backfill row, a video, a link) and
    // every consumer falls back to `url`. See mediaThumbnailSrc() in
    // @platform/types, which is the single place that fallback is decided.
    thumbnailUrl: text("thumbnail_url"),
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
    index("media_asset_source_idx").on(table.source),
    // Backs listMediaAssets / listMediaAssetsCursor.
    //
    // PARTIAL on purpose. Every listing carries the same fixed filter, so
    // putting (deleted_at, pending_save) in the key bought nothing — measured
    // with EXPLAIN, the planner ignored that shape entirely and fell back to
    // media_asset_deleted_at_idx plus a Sort. Moving the filter into the index
    // predicate makes the key exactly the sort order, so a keyset page is a
    // direct ordered scan with no Sort node.
    //
    // The id tie-break is load-bearing: a bulk Gmail ingest writes many rows
    // with an identical created_at, and a cursor comparing created_at alone
    // skips whichever of them falls on the page boundary (verified — a naive
    // seek lost 4 of 5 tied rows).
    index("media_asset_listing_idx")
      .on(table.createdAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL AND ${table.pendingSave} = false`),
  ]
);

export type MediaAsset = typeof mediaAsset.$inferSelect;
export type NewMediaAsset = typeof mediaAsset.$inferInsert;
