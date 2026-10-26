import { eq, lt, sql } from "drizzle-orm";
import { db, pool } from "../client.js";
import { visitorGreeting, type NewVisitorGreeting } from "../schema/visitor-greeting.js";

/**
 * Greeting gate — one row per (visitor, local day). `greetDate` is a
 * 'YYYY-MM-DD' day key computed by the API in GREETING_TZ; this module never
 * derives a date itself.
 */

export type GreetingKind = NonNullable<NewVisitorGreeting["kind"]>;
export type GreetingSource = NonNullable<NewVisitorGreeting["source"]>;

export interface RecordGreetingInput {
  visitorUuid: string;
  greetDate: string;
  /** A real greeting. 'skipped' has its own function: recordSkippedGreeting. */
  kind: Exclude<GreetingKind, "skipped">;
  source: GreetingSource;
}

/**
 * Try to claim today's greeting for a visitor. Returns true when this call won
 * the gate (the caller should greet), false when it was already greeted.
 *
 *  - kind 'generic' (still unknown): INSERT ... DO NOTHING. Any existing row
 *    for today — generic or named — means "already greeted".
 *  - kind 'named': INSERT, or upgrade an existing 'generic' row to 'named' in
 *    place. An existing 'named' row yields no RETURNING row, so false.
 *    This is what lets "greeted as unknown, then renamed" still get one named
 *    greeting while "already greeted by name" never repeats.
 */
export async function recordGreeting(input: RecordGreetingInput): Promise<boolean> {
  const values: NewVisitorGreeting = {
    visitorUuid: input.visitorUuid,
    greetDate: input.greetDate,
    kind: input.kind,
    source: input.source,
  };

  const rows =
    input.kind === "generic"
      ? await db
          .insert(visitorGreeting)
          .values(values)
          .onConflictDoNothing({ target: [visitorGreeting.visitorUuid, visitorGreeting.greetDate] })
          .returning({ id: visitorGreeting.id })
      : await db
          .insert(visitorGreeting)
          .values(values)
          .onConflictDoUpdate({
            target: [visitorGreeting.visitorUuid, visitorGreeting.greetDate],
            set: {
              kind: "named",
              source: sql`excluded.source`,
              greetedAt: sql`now()`,
            },
            setWhere: eq(visitorGreeting.kind, "generic"),
          })
          .returning({ id: visitorGreeting.id });

  return rows.length > 0;
}

export interface RecordSkippedInput {
  visitorUuid: string;
  greetDate: string;
  source: GreetingSource;
  /** Why the screen was busy: 'whiteboard' | 'blanked' | 'content'. */
  reason: string;
}

/**
 * The screen was busy when this visitor was due a greeting: record today's row
 * as 'skipped' so nobody greets them for the rest of the day. INSERT ... DO
 * NOTHING — an existing row (generic, named, or an earlier skip) is never
 * touched, so a visitor already greeted today stays greeted. Returns true if
 * a new 'skipped' row was written.
 *
 * recordGreeting() can't overwrite a 'skipped' row either: 'generic' does
 * nothing on conflict, and 'named' only upgrades a 'generic' row.
 */
export async function recordSkippedGreeting(input: RecordSkippedInput): Promise<boolean> {
  const rows = await db
    .insert(visitorGreeting)
    .values({
      visitorUuid: input.visitorUuid,
      greetDate: input.greetDate,
      kind: "skipped",
      source: input.source,
      skipReason: input.reason,
    })
    .onConflictDoNothing({ target: [visitorGreeting.visitorUuid, visitorGreeting.greetDate] })
    .returning({ id: visitorGreeting.id });
  return rows.length > 0;
}

/**
 * Is this visitor "in the room" — seen by the camera within the last
 * `windowSeconds`? Evaluated on the DB's clock (last_seen is written with the
 * DB's now()), so the API host's clock never enters the comparison.
 */
export async function isVisitorInRoom(visitorUuid: string, windowSeconds: number): Promise<boolean> {
  const { rows } = await pool.query<{ in_room: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM visitor
        WHERE uuid = $1 AND last_seen > now() - make_interval(secs => $2)
     ) AS in_room`,
    [visitorUuid, windowSeconds]
  );
  return rows[0]?.in_room === true;
}

export interface GreetingDayCount {
  kind: GreetingKind;
  /** null unless kind = 'skipped' */
  skipReason: string | null;
  count: number;
}

/** What happened on one local day, grouped by outcome — the status endpoint's durable counts. */
export async function countGreetingsForDay(greetDate: string): Promise<GreetingDayCount[]> {
  const rows = await db
    .select({
      kind: visitorGreeting.kind,
      skipReason: visitorGreeting.skipReason,
      count: sql<number>`count(*)::int`,
    })
    .from(visitorGreeting)
    .where(eq(visitorGreeting.greetDate, greetDate))
    .groupBy(visitorGreeting.kind, visitorGreeting.skipReason);
  return rows;
}

/** Delete rows for days strictly before `beforeDay` ('YYYY-MM-DD'). Returns how many went. */
export async function pruneVisitorGreetings(beforeDay: string): Promise<number> {
  const removed = await db
    .delete(visitorGreeting)
    .where(lt(visitorGreeting.greetDate, beforeDay))
    .returning({ id: visitorGreeting.id });
  return removed.length;
}
