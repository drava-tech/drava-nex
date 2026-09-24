import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One row per lock toggle — persisted history alongside the retained MQTT
 * state (which only ever holds the latest value). See
 * apps/api/src/routes/door-events.ts.
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
    // 'voice' | 'cms' — which actor triggered this toggle. Both paths call
    // the same toggleDoorLock(), so without this a lock event can't be told
    // apart from a CMS operator's click after the fact; important
    // specifically for a door lock, where "who unlocked it and how" is
    // exactly what an audit trail is for.
    source: text("source").notNull().default("cms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("door_event_created_at_idx").on(table.createdAt)]
);

export type DoorEvent = typeof doorEvent.$inferSelect;
export type NewDoorEvent = typeof doorEvent.$inferInsert;
