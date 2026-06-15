import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth.js";

export const projectStatusEnum = pgEnum("project_status", [
  "DRAFT",
  "ACTIVE",
  "ARCHIVED",
]);

export const project = pgTable(
  "project",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("DRAFT"),
    thumbnailUrl: text("thumbnail_url"),
    clientName: text("client_name"),
    location: text("location"),
    settingsJson: jsonb("settings_json")
      .notNull()
      .default(sql`'{}'::jsonb`),
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
    // Partial unique: active slugs must be unique; soft-deleted rows don't block reuse
    uniqueIndex("project_slug_unique_idx")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    index("project_status_idx").on(table.status),
    index("project_created_by_idx").on(table.createdByUserId),
    index("project_deleted_at_idx").on(table.deletedAt),
  ]
);

export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;
