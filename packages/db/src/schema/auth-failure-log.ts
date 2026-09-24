import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One row per rejected request against a machine-to-machine internal route
 * (apps/api/src/routes/voice-internal.ts, routes/internal.ts) — a wrong
 * secret or a rate-limit trip. Previously these only went to console.error,
 * which doesn't survive a process restart or log rotation; a security
 * incident review needs this to be durable. Written by
 * apps/api/src/lib/internal-auth.ts only.
 */
export const authFailureLog = pgTable(
  "auth_failure_log",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    // The router this was rejected from, e.g. 'voice-internal', 'internal/vision-event'.
    route: text("route").notNull(),
    // 'unauthorized' (wrong/missing secret) | 'rate_limited'
    reason: text("reason").notNull(),
    sourceIp: text("source_ip").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("auth_failure_log_created_at_idx").on(table.createdAt)]
);

export type AuthFailureLog = typeof authFailureLog.$inferSelect;
export type NewAuthFailureLog = typeof authFailureLog.$inferInsert;
