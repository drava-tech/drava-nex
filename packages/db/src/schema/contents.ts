import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { experiences } from "./experiences.js";

// ─── Table ────────────────────────────────────────────────────────────────────

export const contents = pgTable(
  "contents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => experiences.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    /**
     * Content type — e.g. "video", "image", "html", "data"
     * Kept as varchar (not enum) for extensibility without migrations.
     */
    type: varchar("type", { length: 100 }).notNull(),
    /**
     * Flexible structured payload for the content item.
     * Example: { "src": "https://...", "duration": 30 }
     */
    data: jsonb("data").notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("contents_experience_id_idx").on(table.experienceId),
    index("contents_active_idx").on(table.active),
    index("contents_type_idx").on(table.type),
  ]
);

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type Content = typeof contents.$inferSelect;
export type NewContent = typeof contents.$inferInsert;
