import { pgTable, text, boolean, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { screen } from "./screens.js";

/**
 * One row per screen per sampling tick — whether that screen had a live player
 * connected at that moment. Backs the dashboard's uptime chart.
 *
 * Written by apps/api/src/services/screen-uptime.ts, because screen liveness
 * exists nowhere else: it lives only in the gateway's in-memory screenRegistry
 * and is lost on every restart.
 *
 * SAMPLED, not event-sourced, and that is the important decision. Writing a row
 * only on connect/disconnect is ~85x cheaper but cannot survive an ungraceful
 * gateway death: the close handlers never run, the "online" row is never
 * closed, and the next boot writes a second "online" row — so the whole outage
 * is silently counted as uptime and the worse the incident the better the chart
 * looks. Independent timestamped samples have no such failure, and a GAP in
 * rows is itself the honest signal that the API was down.
 *
 * NO uuid primary key, unlike the other log tables here. This is an append-only
 * time series (~1,700 rows/day at 5-minute sampling), where a random 36-char id
 * would be ~40% of the row plus a randomly-ordered index for no benefit. The
 * composite key is naturally unique — one sample per screen per tick — is the
 * index the per-screen query wants, and doubles as the idempotency guard for
 * the writer's ON CONFLICT DO NOTHING.
 *
 * `sampledAt` has deliberately NO default: the writer computes ONE timestamp
 * per tick, snapped to the interval boundary, and uses it for every row in that
 * tick. Per-row now() would give a different timestamp per screen, and then a
 * "tick" is not something that can be counted or grouped by.
 *
 * Retention is 90 days, pruned by the same service.
 */
export const screenStatusSample = pgTable(
  "screen_status_sample",
  {
    screenId: text("screen_id")
      .notNull()
      .references(() => screen.screenId, { onDelete: "cascade" }),
    online: boolean("online").notNull(),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.screenId, table.sampledAt] }),
    index("screen_status_sample_sampled_at_idx").on(table.sampledAt),
  ]
);

export type ScreenStatusSample = typeof screenStatusSample.$inferSelect;
export type NewScreenStatusSample = typeof screenStatusSample.$inferInsert;
