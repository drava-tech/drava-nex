import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { mediaAsset } from "./media.js";

// ─── Motion trigger ───────────────────────────────────────────────────────────
// "When this motion sensor sees someone, play this on these screens." The API
// fires it from Home Assistant (a binary_sensor turning on) or from a sensor
// calling POST /api/motion-triggers/fire, and the scheduler shows the content
// over whatever is on, then goes back. See apps/api/src/services/motion-triggers.ts.

export const motionTrigger = pgTable("motion_trigger", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()::text`),
  name: text("name").notNull(),
  /** The sensor: a Home Assistant entity id (binary_sensor.lobby_motion) or any name a sensor sends. */
  sensorId: text("sensor_id").notNull(),
  screenIds: jsonb("screen_ids").$type<string[]>().notNull().default([]),
  groupIds: jsonb("group_ids").$type<string[]>().notNull().default([]),
  /** The image or video to play. */
  mediaAssetId: text("media_asset_id").references(() => mediaAsset.id, { onDelete: "set null" }),
  /** How long it plays: an image's time, or a video's own length (set by the API). */
  durationSeconds: integer("duration_seconds").notNull().default(30),
  /** After it plays, how long before the sensor can trigger it again. */
  cooldownSeconds: integer("cooldown_seconds").notNull().default(300),
  /** When it may trigger: "HH:MM" both null = any time; days 0 = Sunday … 6. */
  startTime: text("start_time"),
  endTime: text("end_time"),
  daysOfWeek: jsonb("days_of_week").$type<number[]>().notNull().default([0, 1, 2, 3, 4, 5, 6]),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MotionTrigger = typeof motionTrigger.$inferSelect;
