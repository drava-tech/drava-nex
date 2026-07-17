import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One row per Yale lock webhook call — persisted history alongside the
 * retained MQTT state (which only ever holds the latest value). See
 * apps/api/src/routes/yale.ts.
 */
export const doorEvent = pgTable(
  "door_event",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    lockId: text("lock_id").notNull(),
    // 'locked' | 'unlocked'
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("door_event_created_at_idx").on(table.createdAt)]
);

export type DoorEvent = typeof doorEvent.$inferSelect;
export type NewDoorEvent = typeof doorEvent.$inferInsert;
