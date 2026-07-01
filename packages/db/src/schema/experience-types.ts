import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth.js";
import { experience } from "./projects.js";

// ─── Experience Type ────────────────────────────────────────────────────────
// A user-managed taxonomy admins create in Settings. Distinct from the
// code-defined `templateKey` on the experience table.

export const experienceType = pgTable(
  "experience_type",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    name: text("name").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("experience_type_name_unique_idx").on(table.name)]
);

// ─── Experience ↔ Type (many-to-many join) ──────────────────────────────────

export const experienceToType = pgTable(
  "experience_to_type",
  {
    experienceId: text("experience_id")
      .notNull()
      .references(() => experience.id, { onDelete: "cascade" }),
    typeId: text("type_id")
      .notNull()
      .references(() => experienceType.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.experienceId, table.typeId] }),
    index("experience_to_type_type_idx").on(table.typeId),
  ]
);

// ─── Inferred Types ─────────────────────────────────────────────────────────

export type ExperienceType = typeof experienceType.$inferSelect;
export type NewExperienceType = typeof experienceType.$inferInsert;
