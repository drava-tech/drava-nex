import { unstable_cache } from "next/cache";
import {
  getMediaLibraryStats,
  getDailyScreenUptime,
  getScreenUptimeRecordingSince,
  getRecentActivity,
  getExperienceStats,
  getUserStats,
  type MediaLibraryStats,
  type DashboardActivityItem,
} from "@platform/db";

/**
 * Short-lived RAM cache for the dashboard's analytics reads.
 *
 * Every dashboard load previously re-ran all of these against Postgres, and the
 * page blocks on the slowest of them before a single byte of HTML streams. They
 * are also the least time-critical numbers on the platform: an uptime chart or a
 * storage total being a few seconds old changes no decision anyone makes.
 *
 * Deliberately NOT cached, and must stay that way: screen state, content
 * assignment and device control. Those are the things an operator acts on and
 * watches land, and they already arrive in real time over the WebSocket — a
 * cache there would show someone a wall that isn't what they just published.
 *
 * ⚠ unstable_cache stores its value as JSON, so anything that goes in as a
 * `Date` comes back out as a STRING while still being typed as a Date. That is
 * invisible at build time and blows up at runtime on the first `.toISOString()`
 * — which is exactly how this shipped broken once (dashboard 500,
 * "a.createdAt.toISOString is not a function"). Every wrapper below that can
 * carry a Date therefore revives it explicitly, and the raw cached function is
 * kept private so nothing can bypass the revival.
 */
const TTL_SECONDS = 20;

export const DASHBOARD_TAG = "dashboard-analytics";

const cacheOpts = { revalidate: TTL_SECONDS, tags: [DASHBOARD_TAG] };

/** Cache round-trips a Date to a string; put it back. */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

// ─── Carries Dates: must be revived ─────────────────────────────────────────

const cachedMediaLibraryStats = unstable_cache(
  getMediaLibraryStats,
  ["dashboard:media-library-stats"],
  cacheOpts
);

export async function getCachedMediaLibraryStats(): Promise<MediaLibraryStats> {
  const stats = await cachedMediaLibraryStats();
  return {
    ...stats,
    recent: stats.recent.map((asset) => ({ ...asset, createdAt: toDate(asset.createdAt) })),
  };
}

const cachedRecentActivity = unstable_cache(
  getRecentActivity,
  ["dashboard:recent-activity"],
  cacheOpts
);

export async function getCachedRecentActivity(): Promise<DashboardActivityItem[]> {
  const items = await cachedRecentActivity();
  return items.map((item) => ({ ...item, at: toDate(item.at) }));
}

const cachedUptimeRecordingSince = unstable_cache(
  getScreenUptimeRecordingSince,
  ["dashboard:uptime-recording-since"],
  cacheOpts
);

export async function getCachedScreenUptimeRecordingSince(): Promise<Date | null> {
  const since = await cachedUptimeRecordingSince();
  return since ? toDate(since) : null;
}

// ─── Plain numbers and strings: safe to hand back as-is ─────────────────────

/**
 * The most expensive of the set: a generate_series calendar cross-joined
 * against the sample table. Even with the sargable lower bound added to the
 * query, it is pure recomputation of a chart that changes every 5 minutes at
 * most (the sampler's interval) — an ideal caching target. Returns
 * already-formatted day/label strings, so nothing to revive.
 */
export const getCachedDailyScreenUptime = unstable_cache(
  getDailyScreenUptime,
  ["dashboard:daily-uptime"],
  cacheOpts
);

export const getCachedExperienceStats = unstable_cache(
  getExperienceStats,
  ["dashboard:experience-stats"],
  cacheOpts
);

export const getCachedUserStats = unstable_cache(
  getUserStats,
  ["dashboard:user-stats"],
  cacheOpts
);
