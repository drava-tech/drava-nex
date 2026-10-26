import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  date,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { visitor } from "./visitors.js";

// ─── Visitor greeting ─────────────────────────────────────────────────────────

/**
 * One row per visitor per local day: "this person was already greeted today".
 * The unique (visitor_uuid, greet_date) key is the whole gate — an arrival
 * greeting is only spoken when its INSERT wins (see queries/visitor-greetings.ts).
 *
 * `greet_date` is the day in GREETING_TZ, computed by the API (never the DB's
 * CURRENT_DATE, which would use the DB server's timezone).
 *
 * `kind` is upgraded in place rather than being part of the key:
 *   'generic' — greeted while still unknown (no name spoken)
 *   'named'   — greeted by name; a rename/merge that finds a 'generic' row
 *               upgrades it, one that finds 'named' does nothing.
 *   'skipped' — NOT a greeting: the screen was busy when this visitor arrived,
 *               so nothing was shown or said. It blocks every greeting for this
 *               visitor for the rest of the day (arrival, rename and merge) and
 *               is only ever inserted when no row exists yet — it never
 *               overwrites 'generic'/'named'. `skip_reason` says why.
 * `source` is what produced the current row: 'arrival' | 'rename' | 'merge'.
 */
export const visitorGreeting = pgTable(
  "visitor_greeting",
  {
    id: serial("id").primaryKey(),
    visitorUuid: uuid("visitor_uuid")
      .notNull()
      .references(() => visitor.uuid, { onDelete: "cascade" }),
    greetDate: date("greet_date", { mode: "string" }).notNull(),
    kind: text("kind").notNull().$type<"generic" | "named" | "skipped">(),
    source: text("source").notNull().$type<"arrival" | "rename" | "merge">(),
    // Why a 'skipped' row was skipped ('whiteboard' | 'blanked' | 'content'); null otherwise.
    skipReason: text("skip_reason"),
    greetedAt: timestamp("greeted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("visitor_greeting_visitor_date_unique_idx").on(
      table.visitorUuid,
      table.greetDate
    ),
    check("visitor_greeting_kind_check", sql`${table.kind} in ('generic', 'named', 'skipped')`),
  ]
);

export type VisitorGreeting = typeof visitorGreeting.$inferSelect;
export type NewVisitorGreeting = typeof visitorGreeting.$inferInsert;
