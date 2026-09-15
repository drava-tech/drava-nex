"use client";

import { Film } from "lucide-react";
import { StatCard } from "./stat-card";
import { formatMediaBytes, useDashboardMedia } from "./media-live-data";

export function MediaAssetsStatCard() {
  const { total, totalBytes, recentCount } = useDashboardMedia();

  // The old "delta" here was recent / all-time-prior, which is not a
  // week-over-week change and could never go negative. Both facts below are
  // straightforwardly true instead.
  return (
    <StatCard
      stat={{
        label: "Media Assets",
        value: String(total),
        breakdown: `${recentCount} added this week · ${formatMediaBytes(totalBytes)} stored`,
      }}
      icon={Film}
      href="/media"
    />
  );
}
