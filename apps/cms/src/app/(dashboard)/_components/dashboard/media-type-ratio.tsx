"use client";

import { FileText, Film, Image as ImageIcon, type LucideIcon } from "lucide-react";
import {
  dashboardMediaGroup,
  useDashboardMedia,
  type DashboardMediaGroup,
} from "./media-live-data";

interface RatioCategory {
  group: Extract<DashboardMediaGroup, "video" | "image" | "document">;
  label: string;
  icon: LucideIcon;
  color: string;
}

const CATEGORIES: RatioCategory[] = [
  { group: "video", label: "Videos", icon: Film, color: "var(--chart-1)" },
  { group: "image", label: "Images", icon: ImageIcon, color: "var(--chart-2)" },
  { group: "document", label: "Documents", icon: FileText, color: "var(--chart-3)" },
];

export function MediaTypeRatio() {
  const assets = useDashboardMedia();
  const counts = { video: 0, image: 0, document: 0, other: 0 };

  for (const asset of assets) counts[dashboardMediaGroup(asset.type)] += 1;

  const trackedTotal = counts.video + counts.image + counts.document;

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Asset ratio</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-white">
            {counts.video} : {counts.image} : {counts.document}
          </p>
        </div>
        <p className="text-right text-xs text-slate-400">
          {trackedTotal} categorized asset{trackedTotal === 1 ? "" : "s"}
        </p>
      </div>

      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-white/5"
        role="img"
        aria-label={`${counts.video} videos, ${counts.image} images, ${counts.document} documents`}
      >
        {CATEGORIES.map((category) => {
          const percentage = trackedTotal > 0 ? (counts[category.group] / trackedTotal) * 100 : 0;
          return (
            <span
              key={category.group}
              className="h-full transition-[width] duration-300"
              style={{ width: `${percentage}%`, backgroundColor: category.color }}
            />
          );
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        {CATEGORIES.map((category) => {
          const Icon = category.icon;
          const count = counts[category.group];
          const percentage = trackedTotal > 0 ? Math.round((count / trackedTotal) * 100) : 0;
          return (
            <div key={category.group} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center gap-2 text-slate-300">
                <Icon className="h-4 w-4" style={{ color: category.color }} />
                <span className="text-xs">{category.label}</span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <span className="text-xl font-semibold tabular-nums text-white">{count}</span>
                <span className="text-xs tabular-nums text-slate-400">{percentage}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {counts.other > 0 && (
        <p className="text-xs text-slate-500">
          {counts.other} linked or embedded asset{counts.other === 1 ? " is" : "s are"} not included in this ratio.
        </p>
      )}
    </div>
  );
}
