import { recordScreenStatusSample, pruneScreenStatusSamples } from "@platform/db";
import { getConnectedScreenIds } from "../ws/gateway.js";

/**
 * Records which screens are online, on a timer, so the dashboard's uptime chart
 * has something true to draw.
 *
 * Screen liveness lives only in the gateway's in-memory screenRegistry and is
 * lost on every restart, so nothing about it has ever been persisted. See the
 * schema docblock (packages/db/src/schema/screen-status-samples.ts) for why
 * this samples on a timer instead of recording connect/disconnect transitions.
 */

/**
 * 5 minutes: 288 ticks/day, ~1,700 rows/day across the fleet, ~17 MB at the
 * 90-day retention below. 15 minutes would cost a third of that and still give
 * ~1% daily resolution, but it makes a 10-minute outage invisible, and being
 * able to see a real incident is the point of recording this at all.
 */
const SAMPLE_INTERVAL_MS = 5 * 60_000;

/** Kept long enough to leave a 30- or 90-day view open later; it costs ~17 MB. */
const RETENTION_DAYS = 90;

const PRUNE_INTERVAL_MS = 24 * 60 * 60_000;

let lastPrunedAt = 0;

async function tick(): Promise<void> {
  // One timestamp for the whole tick, snapped to the interval boundary.
  //
  // Snapped rather than raw Date.now() so a tick is a countable thing: every
  // row in it shares an identical sampled_at, which makes the per-day ratio
  // exact and count(DISTINCT sampled_at) a truthful "how many samples do we
  // actually have for this day". It also means two processes sampling the same
  // window collide on the primary key and the writer's ON CONFLICT DO NOTHING
  // keeps one row instead of double-counting — cheap insurance, since the
  // gateway is single-process by construction today (container_name pins it,
  // and its whole registry is in-process memory anyway).
  const sampledAt = new Date(Math.floor(Date.now() / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS);

  await recordScreenStatusSample(getConnectedScreenIds(), sampledAt);

  if (Date.now() - lastPrunedAt > PRUNE_INTERVAL_MS) {
    lastPrunedAt = Date.now();
    const removed = await pruneScreenStatusSamples(RETENTION_DAYS);
    if (removed > 0) console.info(`[uptime] pruned ${removed} samples older than ${RETENTION_DAYS} days`);
  }
}

export function startScreenUptimeSampler(): void {
  // No leading sample. Screens take seconds-to-minutes to reconnect after a
  // deploy, so a tick at T+0 would record the whole fleet offline every single
  // time the API restarts — turning every deploy into a fake outage.
  setInterval(() => {
    void tick().catch((err) => console.error("[uptime] sample failed:", err));
  }, SAMPLE_INTERVAL_MS);

  console.info(
    `[uptime] sampling screen status every ${SAMPLE_INTERVAL_MS / 60_000}m, keeping ${RETENTION_DAYS} days`
  );
}
