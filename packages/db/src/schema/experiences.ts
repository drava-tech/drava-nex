import {
  pgTable,
  uuid,
  varchar,
  boolean,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { templates } from "./templates.js";

// ─── Table ────────────────────────────────────────────────────────────────────

export const experiences = pgTable(
  "experiences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    description: text("description"),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("experiences_slug_unique_idx").on(table.slug),
    index("experiences_template_id_idx").on(table.templateId),
    index("experiences_active_idx").on(table.active),
  ]
);

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type Experience = typeof experiences.$inferSelect;
export type NewExperience = typeof experiences.$inferInsert;
