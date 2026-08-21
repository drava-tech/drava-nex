"use client";

import { Film } from "lucide-react";
import { StatCard } from "./stat-card";
import { formatMediaBytes, useDashboardMedia } from "./media-live-data";

export function MediaAssetsStatCard() {
  const assets = useDashboardMedia();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1_000;
  const recent = assets.filter((asset) => Date.parse(asset.createdAt) >= weekAgo).length;
  const previous = assets.length - recent;
  const delta = previous > 0 ? (recent / previous) * 100 : recent > 0 ? 100 : 0;
  const totalBytes = assets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);

  return (
    <StatCard
      stat={{
        label: "Media Assets",
        value: String(assets.length),
        delta: Math.round(delta * 10) / 10,
        breakdown: `${recent} added in the last 7 days · ${formatMediaBytes(totalBytes)} stored`,
      }}
      icon={Film}
      href="/media"
    />
  );
}
