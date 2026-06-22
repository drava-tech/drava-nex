import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth.js";

export const experience = pgTable(
  "experience",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    // Which code-defined template is assigned to this experience (e.g. 'portfolio').
    // Null = no template assigned yet.
    templateKey: text("template_key"),
    // Per-template content, keyed by templateKey: { [templateKey]: <content> }.
    // Keyed so switching templates never erases another template's content.
    templateContent: jsonb("template_content").$type<Record<string, unknown>>(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("experience_slug_unique_idx")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    index("experience_created_by_idx").on(table.createdByUserId),
    index("experience_deleted_at_idx").on(table.deletedAt),
  ]
);

export type Experience = typeof experience.$inferSelect;
export type NewExperience = typeof experience.$inferInsert;
