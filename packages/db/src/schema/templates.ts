import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ─── Table ────────────────────────────────────────────────────────────────────

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    componentName: varchar("component_name", { length: 255 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("templates_slug_unique_idx").on(table.slug),
    index("templates_component_name_idx").on(table.componentName),
  ]
);

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
