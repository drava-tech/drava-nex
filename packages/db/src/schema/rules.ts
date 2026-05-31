import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// ─── Table ────────────────────────────────────────────────────────────────────

export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    /**
     * Trigger condition as a structured JSON payload.
     * Example: { "event": "mqtt", "topic": "sensor/temp", "condition": "> 30" }
     */
    trigger: jsonb("trigger").notNull(),
    /**
     * Action to execute when trigger fires.
     * Example: { "type": "switch_content", "contentId": "uuid-here" }
     */
    action: jsonb("action").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("rules_enabled_idx").on(table.enabled),
  ]
);

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type Rule = typeof rules.$inferSelect;
export type NewRule = typeof rules.$inferInsert;
