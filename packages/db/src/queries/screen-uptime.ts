import { sql } from "drizzle-orm";
import { db } from "../client.js";

/**
 * Reporting timezone for the uptime chart.
 *
 * Pinned rather than left to the server's TimeZone, which in the API container
 * is UTC: date_trunc there would break "days" at 05:30 local, so "Monday" would
 * contain most of Sunday evening and every figure would be quietly wrong.
 */
export const UPTIME_TIME_ZONE = "Asia/Kolkata";

/**
 * The window uptime is measured over.
 *
 * Deliberately NOT 24/7. The screens are switched off outside office hours, so
 * a 24-hour denominator would pin "share of screens online" near 40% forever
 * and read ~0% at weekends — a number nobody can act on, which is exactly the
 * problem the fabricated data had. Measuring only the hours the screens are
 * meant to be up makes a dip mean something.
 *
 * Hours are half-open [start, end) in UPTIME_TIME_ZONE; days are ISO
 * (1 = Monday ... 7 = Sunday).
 */
export const UPTIME_WINDOW = {
  startHour: 9,
  endHour: 19,
  /** Mon-Fri. */
  days: [1, 2, 3, 4, 5],
} as const;

export interface DailyUptimePoint {
  /** ISO date (YYYY-MM-DD) in UPTIME_TIME_ZONE. */
  day: string;
  /** Short weekday label, derived in the same zone so it cannot disagree. */
  label: string;
  /**
   * Percent of samples in which a screen was online, or null when no samples
   * were recorded for that day — a real state (the API was down, or recording
   * had not started yet) that must not be drawn as 0%.
   */
  value: number | null;
  /** How many samples backed `value`, so a sparse day can be flagged. */
  sampleCount: number;
}

/**
 * Record one sampling tick.
 *
 * A single INSERT ... SELECT over the screen table rather than a read followed
 * by a write: one round trip, and no window in which a screen added between the
 * two would be missed. Soft-deleted screens are excluded — including one would
 * record it offline forever and drag the fleet average down permanently.
 *
 * `sampledAt` is supplied by the caller (snapped to the interval boundary) and
 * shared by every row in the tick; ON CONFLICT DO NOTHING then makes a
 * duplicate tick harmless rather than a skew in the ratio.
 */
// NOTE on sql.param() below: interpolating a JS array into a drizzle `sql`
// template SPREADS it into one bind parameter per element, so ANY($1::text[])
// receives a bare string and Postgres fails with "malformed array literal".
// sql.param() binds the array as a single parameter, which node-postgres then
// serialises to a real array literal. Every ANY(...) here needs it.
export async function recordScreenStatusSample(
  onlineScreenIds: string[],
  sampledAt: Date
): Promise<void> {
  await db.execute(sql`
    INSERT INTO screen_status_sample (screen_id, online, sampled_at)
    SELECT s.screen_id, s.screen_id = ANY(${sql.param(onlineScreenIds)}::text[]), ${sampledAt}
    FROM screen s
    WHERE s.deleted_at IS NULL
    ON CONFLICT (screen_id, sampled_at) DO NOTHING
  `);
}

/**
 * Daily uptime for the last `days` complete WORKING days, ending yesterday.
 *
 * Working days, not calendar days, because UPTIME_WINDOW only counts office
 * hours: a Saturday could never have a sample in it, so including one would
 * put a permanent hole in every chart and make a real gap indistinguishable
 * from a weekend.
 *
 * Today is excluded on purpose too: a partial day always has fewer samples so
 * far, so its bar always droops, and every operator reads that as a decline
 * rather than as "the day isn't over".
 *
 * Always returns exactly `days` rows — a generated calendar left-joined to the
 * samples — so the chart never has to reason about a short or empty array.
 */
export async function getDailyScreenUptime(days = 7): Promise<DailyUptimePoint[]> {
  const { rows } = await db.execute<{
    day: string;
    label: string;
    value: string | null;
    sample_count: string;
  }>(sql`
    WITH days AS (
      -- Walk back far enough to be sure of finding enough working days even
      -- across a long weekend, filter to the working ones, then keep the most
      -- recent of those.
      SELECT day FROM (
        SELECT generate_series(
          (now() AT TIME ZONE ${UPTIME_TIME_ZONE})::date - (${days}::int * 3),
          (now() AT TIME ZONE ${UPTIME_TIME_ZONE})::date - 1,
          '1 day'::interval
        )::date AS day
      ) all_days
      WHERE extract(isodow FROM day) = ANY(${sql.param([...UPTIME_WINDOW.days])}::int[])
      ORDER BY day DESC
      LIMIT ${days}
    ),
    windowed AS (
      SELECT
        (s.sampled_at AT TIME ZONE ${UPTIME_TIME_ZONE})::date AS day,
        s.online
      FROM screen_status_sample s
      WHERE extract(hour  FROM s.sampled_at AT TIME ZONE ${UPTIME_TIME_ZONE})
              >= ${UPTIME_WINDOW.startHour}
        AND extract(hour  FROM s.sampled_at AT TIME ZONE ${UPTIME_TIME_ZONE})
              <  ${UPTIME_WINDOW.endHour}
        AND extract(isodow FROM s.sampled_at AT TIME ZONE ${UPTIME_TIME_ZONE})
              = ANY(${sql.param([...UPTIME_WINDOW.days])}::int[])
    )
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS day,
      to_char(d.day, 'Dy')         AS label,
      CASE WHEN count(w.online) = 0 THEN NULL
           ELSE round(100.0 * count(*) FILTER (WHERE w.online) / count(w.online), 1)
      END                          AS value,
      count(w.online)              AS sample_count
    FROM days d
    LEFT JOIN windowed w ON w.day = d.day
    GROUP BY d.day
    ORDER BY d.day
  `);

  return rows.map((r) => ({
    day: r.day,
    label: r.label.trim(),
    value: r.value === null ? null : Number(r.value),
    sampleCount: Number(r.sample_count),
  }));
}

/**
 * When sampling started, so the chart can say so rather than looking broken.
 *
 * NOTE: db.execute() bypasses drizzle's column mapping, so Postgres timestamps
 * come back as STRINGS, not Dates — and the type argument to execute<T>() is an
 * unchecked assertion, so annotating them as Date compiles happily and then
 * throws "toLocaleDateString is not a function" at the caller. Every timestamp
 * read through execute() has to be converted explicitly, as here and in
 * getRecentActivity.
 */
export async function getScreenUptimeRecordingSince(): Promise<Date | null> {
  const { rows } = await db.execute<{ first: string | Date | null }>(sql`
    SELECT min(sampled_at) AS first FROM screen_status_sample
  `);
  const raw = rows[0]?.first;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Drop samples older than the retention window. Returns the row count. */
export async function pruneScreenStatusSamples(olderThanDays: number): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM screen_status_sample
    WHERE sampled_at < now() - (${olderThanDays}::int * interval '1 day')
  `);
  return result.rowCount ?? 0;
}
