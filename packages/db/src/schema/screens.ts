import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { experience } from "./projects.js";
import { mediaAsset } from "./media.js";

export const screen = pgTable(
  "screen",
  {
    // Natural key — the id the physical screen registers with over WebSocket.
    screenId: text("screen_id").primaryKey(),
    screenName: text("screen_name").notNull(),
    // Discriminated "what is currently displayed" reference. Exactly one of the
    // typed refs below is set, chosen by the kind. null = nothing assigned.
    // 'experience' | 'media' (text so future kinds don't need an enum migration).
    currentContentKind: text("current_content_kind"),
    // The experience currently assigned (set when kind = 'experience').
    currentExperienceId: text("current_experience_id").references(
      () => experience.id,
      { onDelete: "set null" }
    ),
    // The media asset currently assigned (set when kind = 'media').
    currentMediaAssetId: text("current_media_asset_id").references(
      () => mediaAsset.id,
      { onDelete: "set null" }
    ),
    // Fallback video/image shown when nothing is currently assigned (and once a
    // camera-detection takeover ends with no other assignment to fall back to).
    defaultMediaAssetId: text("default_media_asset_id").references(
      () => mediaAsset.id,
      { onDelete: "set null" }
    ),
    position: integer("position").notNull().default(0),
    // Overlays whatever content is assigned above — set while a CMS operator
    // is live-pushing a whiteboard to this screen, so a display-page refresh
    // can resume it instead of falling back to the assigned content. Cleared
    // (active=false, state=null) when the operator explicitly stops it.
    whiteboardActive: boolean("whiteboard_active").notNull().default(false),
    // Shape: { surface: "light"|"dark"|"clear", strokes: WhiteboardStroke[] } —
    // owned by apps/cms/src/lib/whiteboard-canvas.ts, stored loosely here same
    // convention as experience.templateContent.
    whiteboardState: jsonb("whiteboard_state").$type<unknown>(),
    // Full-black overlay covering whatever is assigned (content, whiteboard, or
    // both) — set by an admin's "Stop" action, cleared by "Resume". Persisted
    // (not just an in-memory WS relay) so a screen that reconnects mid-stop
    // (power cycle, network blip, API restart) comes back up still black.
    blanked: boolean("blanked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("screen_current_experience_idx").on(table.currentExperienceId),
    index("screen_current_media_asset_idx").on(table.currentMediaAssetId),
    index("screen_default_media_asset_idx").on(table.defaultMediaAssetId),
    index("screen_deleted_at_idx").on(table.deletedAt),
  ]
);

export type Screen = typeof screen.$inferSelect;
export type NewScreen = typeof screen.$inferInsert;
