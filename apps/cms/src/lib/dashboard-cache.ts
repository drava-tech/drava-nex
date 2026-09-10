import { unstable_cache } from "next/cache";
import {
  getMediaLibraryStats,
  getDailyScreenUptime,
  getScreenUptimeRecordingSince,
  getRecentActivity,
  getExperienceStats,
  getUserStats,
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
 * TTL is the primary freshness mechanism. `revalidatePath` (used throughout
 * actions/*.ts) invalidates the *route* cache, not these entries — clearing
 * them needs `revalidateTag(DASHBOARD_TAG)`, which is wired below for the cases
 * where a mutation should show up immediately.
 */
const TTL_SECONDS = 20;

export const DASHBOARD_TAG = "dashboard-analytics";

const cacheOpts = { revalidate: TTL_SECONDS, tags: [DASHBOARD_TAG] };

export const getCachedMediaLibraryStats = unstable_cache(
  getMediaLibraryStats,
  ["dashboard:media-library-stats"],
  cacheOpts
);

/**
 * The most expensive of the set: a generate_series calendar cross-joined
 * against the sample table. Even with the sargable lower bound added to the
 * query, it is pure recomputation of a chart that changes every 5 minutes at
 * most (the sampler's interval) — an ideal caching target.
 */
export const getCachedDailyScreenUptime = unstable_cache(
  getDailyScreenUptime,
  ["dashboard:daily-uptime"],
  cacheOpts
);

export const getCachedScreenUptimeRecordingSince = unstable_cache(
  getScreenUptimeRecordingSince,
  ["dashboard:uptime-recording-since"],
  cacheOpts
);

export const getCachedRecentActivity = unstable_cache(
  getRecentActivity,
  ["dashboard:recent-activity"],
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
