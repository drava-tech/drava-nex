import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { screens } from "./screens.js";
import { experiences } from "./experiences.js";
import { contents } from "./contents.js";

// ─── Table ────────────────────────────────────────────────────────────────────

/**
 * Junction table that binds a screen to a specific experience + content pair.
 * A screen can have at most one active assignment at a time (enforced at app level).
 * The unique index on (screen_id, experience_id, content_id) prevents duplicate bindings.
 */
export const screenAssignments = pgTable(
  "screen_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    screenId: uuid("screen_id")
      .notNull()
      .references(() => screens.id, { onDelete: "cascade" }),
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => experiences.id, { onDelete: "cascade" }),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Prevent duplicate (screen, experience, content) triplets
    uniqueIndex("screen_assignments_unique_triplet_idx").on(
      table.screenId,
      table.experienceId,
      table.contentId
    ),
    index("screen_assignments_screen_id_idx").on(table.screenId),
    index("screen_assignments_experience_id_idx").on(table.experienceId),
    index("screen_assignments_content_id_idx").on(table.contentId),
    index("screen_assignments_active_idx").on(table.active),
  ]
);

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type ScreenAssignment = typeof screenAssignments.$inferSelect;
export type NewScreenAssignment = typeof screenAssignments.$inferInsert;
