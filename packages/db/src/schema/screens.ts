import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { experience } from "./projects.js";

export const screen = pgTable(
  "screen",
  {
    // Natural key — the id the physical screen registers with over WebSocket.
    screenId: text("screen_id").primaryKey(),
    screenName: text("screen_name").notNull(),
    // The experience currently assigned to this screen (null = nothing assigned).
    currentExperienceId: text("current_experience_id").references(
      () => experience.id,
      { onDelete: "set null" }
    ),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("screen_current_experience_idx").on(table.currentExperienceId),
    index("screen_deleted_at_idx").on(table.deletedAt),
  ]
);

export type Screen = typeof screen.$inferSelect;
export type NewScreen = typeof screen.$inferInsert;
