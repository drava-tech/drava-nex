import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ─── Table ────────────────────────────────────────────────────────────────────

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    type: varchar("type", { length: 100 }).notNull(),
    mqttTopic: varchar("mqtt_topic", { length: 500 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("devices_mqtt_topic_idx").on(table.mqttTopic),
    index("devices_enabled_idx").on(table.enabled),
    index("devices_type_idx").on(table.type),
  ]
);

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
