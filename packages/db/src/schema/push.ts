import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { user } from "./auth"

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}

/**
 * An uploaded file (in R2) or a pasted link. Stores WHERE the bytes are —
 * bucket + key — never a URL. The URL a browser loads is derived at read time,
 * so a hostname change or a switch between the public domain and presigned
 * redirects never requires rewriting rows.
 */
export const mediaAsset = pgTable(
  "media_asset",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    type: text("type", {
      enum: ["image", "video", "document", "sheet", "presentation", "word", "link"],
    }).notNull(),
    name: text("name").notNull(),
    bucket: text("bucket"),
    objectKey: text("object_key"),
    contentType: text("content_type"),
    // bigint, not integer: integer tops out at 2.1 GB.
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    thumbObjectKey: text("thumb_object_key"),
    externalUrl: text("external_url"),
    uploadedByUserId: text("uploaded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Backs the library listing. DESC NULLS FIRST is what a plain
    // `ORDER BY created_at DESC, id DESC` means — drizzle's bare .desc() emits
    // NULLS LAST, which the planner cannot use for that ORDER BY (it adds a Sort).
    // PARTIAL, so the listing's fixed filter IS the
    // index predicate and a keyset page is an ordered index scan with no Sort.
    // The id tie-break is load-bearing: a bulk upload writes rows with the same
    // created_at, and a cursor on created_at alone drops rows at page edges.
    index("media_asset_listing_idx")
      .on(t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex("media_asset_object_idx")
      .on(t.bucket, t.objectKey)
      .where(sql`${t.objectKey} IS NOT NULL`),
    check(
      "media_asset_has_location",
      sql`(${t.objectKey} IS NOT NULL AND ${t.bucket} IS NOT NULL) OR ${t.externalUrl} IS NOT NULL`
    ),
  ]
)

/**
 * A physical display. `id` doubles as the WebSocket room key, so it is always
 * generated server-side (`scr_` + 16 hex) and never chosen by a client.
 */
export const screen = pgTable(
  "screen",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // sha256 of the device token issued at pairing; null = not paired.
    deviceTokenHash: text("device_token_hash"),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    currentMediaId: text("current_media_id").references(() => mediaAsset.id, {
      onDelete: "set null",
    }),
    queueMediaIds: jsonb("queue_media_ids").$type<string[]>().default([]).notNull(),
    queueIndex: integer("queue_index").default(0).notNull(),
    // Shown whenever nothing is assigned.
    defaultMediaId: text("default_media_id").references(() => mediaAsset.id, {
      onDelete: "set null",
    }),
    blanked: boolean("blanked").default(false).notNull(),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("screen_listing_idx").on(t.createdAt).where(sql`${t.deletedAt} IS NULL`),
  ]
)

/** Short-lived code an operator reads off the console and types on a screen. */
export const pairingCode = pgTable(
  "pairing_code",
  {
    code: text("code").primaryKey(),
    screenId: text("screen_id")
      .notNull()
      .references(() => screen.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("pairing_code_screen_idx").on(t.screenId)]
)

/** Append-only audit log: what went to which screen, when, and by whom. */
export const contentPush = pgTable(
  "content_push",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    screenId: text("screen_id")
      .notNull()
      .references(() => screen.id, { onDelete: "cascade" }),
    // null = cleared back to the default item / idle.
    mediaId: text("media_id").references(() => mediaAsset.id, { onDelete: "set null" }),
    action: text("action", {
      enum: ["media", "queue", "navigate", "default", "clear", "blank", "unblank"],
    }).notNull(),
    pushedByUserId: text("pushed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    pushedAt: timestamp("pushed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("content_push_screen_idx").on(t.screenId, t.pushedAt.desc().nullsFirst())]
)

export type MediaAssetRow = typeof mediaAsset.$inferSelect
export type NewMediaAssetRow = typeof mediaAsset.$inferInsert
export type ScreenRow = typeof screen.$inferSelect
export type NewScreenRow = typeof screen.$inferInsert
export type PairingCodeRow = typeof pairingCode.$inferSelect
export type ContentPushRow = typeof contentPush.$inferSelect
