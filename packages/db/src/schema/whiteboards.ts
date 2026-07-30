import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth.js";

export const whiteboardDocument = pgTable(
  "whiteboard_document",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    name: text("name").notNull(),
    // Array of pages, each `{ surface: "light"|"dark"|"clear", strokes: WhiteboardStroke[] }`
    // (shape owned by apps/cms/src/lib/whiteboard-canvas.ts, same convention as
    // experience.templateContent — the DB layer stores it loosely, the app validates it).
    pages: jsonb("pages").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
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
    index("whiteboard_document_created_by_idx").on(table.createdByUserId),
    index("whiteboard_document_deleted_at_idx").on(table.deletedAt),
  ]
);

export type WhiteboardDocument = typeof whiteboardDocument.$inferSelect;
export type NewWhiteboardDocument = typeof whiteboardDocument.$inferInsert;
