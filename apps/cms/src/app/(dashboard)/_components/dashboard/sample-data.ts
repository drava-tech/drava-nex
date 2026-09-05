import type { DailyUptimePoint, DashboardActivityItem } from "@platform/db";

/**
 * Placeholder data for dashboard cards that have nothing real to show yet — a
 * fresh install, or the uptime chart during the first days of recording.
 *
 * Two rules, both load-bearing:
 *
 * 1. EVERY card using this must render <SampleBadge/> alongside it. A number on
 *    an operations dashboard that looks real and isn't is worse than an empty
 *    card: it is what leads someone to believe a screen is up when it has been
 *    dark for two days.
 *
 * 2. DETERMINISTIC, never Math.random(). These values are produced during the
 *    server render and again during client hydration; a real RNG would give
 *    different numbers in each pass and React would throw a hydration mismatch.
 *    The hash below is seeded from a stable string so both passes agree.
 */

/** FNV-1a. Small, stable, and identical on server and client. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * Fill a real 7-day skeleton with plausible uptime values.
 *
 * The days and labels are the REAL ones from the query — only the values are
 * invented, so the x-axis never lies about which dates are being shown. Values
 * land in 92-100% with one lower day, which is what a healthy week looks like.
 */
export function sampleUptimeSeries(skeleton: DailyUptimePoint[]): DailyUptimePoint[] {
  return skeleton.map((point, i) => {
    const r = hash(point.day);
    const dip = i === 3;
    const value = dip ? 78 + Math.round(r * 8) : 92 + Math.round(r * 8);
    return { ...point, value: Math.min(100, value), sampleCount: 120 };
  });
}

/** Placeholder feed for a dashboard with no pushes or uploads recorded yet. */
export function sampleActivity(): DashboardActivityItem[] {
  const now = Date.now();
  const mins = (m: number) => new Date(now - m * 60_000);
  return [
    { id: "sample-1", kind: "screen", action: "pushed", target: "Showreel.mp4 → Main Screen", at: mins(8) },
    { id: "sample-2", kind: "media", action: "uploaded", target: "Company Profile.pdf", at: mins(52) },
    { id: "sample-3", kind: "experience", action: "pushed", target: "Welcome Screen → Lobby", at: mins(180) },
    { id: "sample-4", kind: "media", action: "added", target: "Product Launch.mp4", at: mins(1_500) },
  ];
}
