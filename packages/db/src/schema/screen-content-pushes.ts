import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { screen } from "./screens.js";
import { mediaAsset } from "./media.js";
import { experience } from "./projects.js";

/**
 * One row per piece of content pushed to a screen — media or experience,
 * discriminated by contentKind (mirrors screen.currentContentKind's
 * mutually-exclusive-typed-ref shape) — an append-only log, unlike
 * `screen`'s current-content columns, which only ever hold the latest
 * state. Backs the "Recently Opened" tab in ScreenAssignmentPicker.
 */
export const screenContentPush = pgTable(
  "screen_content_push",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    screenId: text("screen_id")
      .notNull()
      .references(() => screen.screenId, { onDelete: "cascade" }),
    // 'media' | 'experience' — exactly one of mediaAssetId/experienceId is set.
    contentKind: text("content_kind").notNull(),
    mediaAssetId: text("media_asset_id").references(() => mediaAsset.id, { onDelete: "cascade" }),
    experienceId: text("experience_id").references(() => experience.id, { onDelete: "cascade" }),
    pushedAt: timestamp("pushed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("screen_content_push_screen_id_idx").on(table.screenId),
    index("screen_content_push_pushed_at_idx").on(table.pushedAt),
    index("screen_content_push_experience_id_idx").on(table.experienceId),
  ]
);

export type ScreenContentPush = typeof screenContentPush.$inferSelect;
export type NewScreenContentPush = typeof screenContentPush.$inferInsert;
