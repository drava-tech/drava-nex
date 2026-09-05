"use client";

import { Film } from "lucide-react";
import { StatCard } from "./stat-card";
import { formatMediaBytes, useDashboardMedia } from "./media-live-data";

export function MediaAssetsStatCard() {
  const assets = useDashboardMedia();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1_000;
  const recent = assets.filter((asset) => Date.parse(asset.createdAt) >= weekAgo).length;
  const totalBytes = assets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);

  // The old "delta" here was recent / all-time-prior, which is not a
  // week-over-week change and could never go negative. Both facts below are
  // straightforwardly true instead.
  return (
    <StatCard
      stat={{
        label: "Media Assets",
        value: String(assets.length),
        breakdown: `${recent} added this week · ${formatMediaBytes(totalBytes)} stored`,
      }}
      icon={Film}
      href="/media"
    />
  );
}
