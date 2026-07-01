import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Registered device the platform can address over REST (/api/devices) — lights,
 * scenes, speakers, cameras, etc. The actual transport (MQTT / DMX / OSC / vendor
 * SDK) is decided by a driver keyed off `config.driver`; this row is the stable
 * contract Unreal Engine and IoT clients talk to. `state` is last-known desired
 * state; `config` holds driver-specific wiring. See apps/api/src/services/devices.ts.
 */
export const device = pgTable(
  "device",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    // Stable external/physical identifier the client and driver reference.
    deviceId: text("device_id").notNull(),
    // 'light' | 'scene' | 'camera' | 'speaker' | 'generic' (text so new kinds need no migration).
    type: text("type").notNull(),
    name: text("name").notNull(),
    // 'online' | 'offline' | 'unknown'
    status: text("status").notNull().default("unknown"),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("device_device_id_unique_idx").on(table.deviceId),
    index("device_type_idx").on(table.type),
    index("device_deleted_at_idx").on(table.deletedAt),
  ]
);

export type Device = typeof device.$inferSelect;
export type NewDevice = typeof device.$inferInsert;
