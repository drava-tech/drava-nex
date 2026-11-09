import { pgTable, text, timestamp, integer, boolean, jsonb, date, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth.js";
import { screen } from "./screens.js";
import { experience } from "./projects.js";
import { mediaAsset } from "./media.js";

// ─── Schedule ─────────────────────────────────────────────────────────────────
// A playlist of content that runs on chosen screens inside a time window. The
// timing rules (and how overlaps are settled) live in @platform/types
// schedule.ts; the API's scheduler applies them to the screens.

export const schedule = pgTable("schedule", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()::text`),
  name: text("name").notNull(),
  /** Hex colour for the CMS's calendar blocks. */
  color: text("color").notNull().default("#92ff5f"),
  enabled: boolean("enabled").notNull().default(true),
  /** Higher wins when two schedules cover the same screen at the same time. */
  priority: integer("priority").notNull().default(0),
  /** Inclusive local dates; null = open-ended. */
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  /** 0 = Sunday … 6 = Saturday. */
  daysOfWeek: jsonb("days_of_week").$type<number[]>().notNull().default([0, 1, 2, 3, 4, 5, 6]),
  /** "HH:MM"; both null = all day. */
  startTime: text("start_time"),
  endTime: text("end_time"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  /** true: the queue repeats until the window ends; false: it plays once. */
  loop: boolean("loop").notNull().default(true),
  /** Play once only: what the screens show after the queue; null = their idle screen. */
  afterMediaAssetId: text("after_media_asset_id").references(() => mediaAsset.id, { onDelete: "set null" }),
  /** Screens targeted directly, and groups whose screens are targeted (resolved live). */
  screenIds: jsonb("screen_ids").$type<string[]>().notNull().default([]),
  groupIds: jsonb("group_ids").$type<string[]>().notNull().default([]),
  createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Schedule item ────────────────────────────────────────────────────────────
// One entry of the playlist, in `position` order. Exactly one of the content
// refs is set, by `contentKind`.

export const scheduleItem = pgTable(
  "schedule_item",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedule.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /** 'experience' | 'media' */
    contentKind: text("content_kind").notNull(),
    experienceId: text("experience_id").references(() => experience.id, { onDelete: "cascade" }),
    mediaAssetId: text("media_asset_id").references(() => mediaAsset.id, { onDelete: "cascade" }),
    durationSeconds: integer("duration_seconds").notNull().default(30),
  },
  (table) => [index("schedule_item_schedule_idx").on(table.scheduleId, table.position)]
);

// ─── Schedule screen state ────────────────────────────────────────────────────
// What the scheduler last put on each screen, so it only acts when the
// schedule moves on (and a manual push stays up until then), and so a
// restart doesn't re-push everything.

export const scheduleScreenState = pgTable("schedule_screen_state", {
  screenId: text("screen_id")
    .primaryKey()
    .references(() => screen.screenId, { onDelete: "cascade" }),
  scheduleId: text("schedule_id").notNull(),
  /** ScheduleResolution.key of the item applied. */
  itemKey: text("item_key").notNull(),
  contentKind: text("content_kind").notNull(),
  contentId: text("content_id").notNull(),
  /** What the screen showed before the scheduler took it over, put back when the schedule ends. */
  previousContentKind: text("previous_content_kind"),
  previousContentId: text("previous_content_id"),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Schedule = typeof schedule.$inferSelect;
export type NewSchedule = typeof schedule.$inferInsert;
export type ScheduleItem = typeof scheduleItem.$inferSelect;
export type ScheduleScreenState = typeof scheduleScreenState.$inferSelect;
