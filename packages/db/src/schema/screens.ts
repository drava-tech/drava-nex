import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

// ─── Enum ─────────────────────────────────────────────────────────────────────

export const screenStatusEnum = pgEnum("screen_status", [
  "online",
  "offline",
  "maintenance",
]);

// ─── Table ────────────────────────────────────────────────────────────────────

export const screens = pgTable(
  "screens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 100 }).notNull(),
    status: screenStatusEnum("status").notNull().default("offline"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("screens_code_unique_idx").on(table.code),
    index("screens_status_idx").on(table.status),
  ]
);

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type Screen = typeof screens.$inferSelect;
export type NewScreen = typeof screens.$inferInsert;
