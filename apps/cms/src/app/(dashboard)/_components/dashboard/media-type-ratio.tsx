"use client";

import { FileText, Film, Image as ImageIcon, type LucideIcon } from "lucide-react";
import {
  groupMediaStats,
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
  const { byType } = useDashboardMedia();
  const { counts } = groupMediaStats(byType);

  const trackedTotal = counts.video + counts.image + counts.document;

  return (
    // @container: the card sits in a side column, half a row or a full row
    // depending on the page width, so it lays itself out by its own width.
    <div className="@container space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Asset ratio</p>
          <p className="mt-1 whitespace-nowrap text-xl tabular-nums text-foreground @xs:text-2xl">
            {counts.video} : {counts.image} : {counts.document}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {trackedTotal} categorized asset{trackedTotal === 1 ? "" : "s"}
        </p>
      </div>

      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
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

      {/* Three tiles once there is room for them; one row each before that. */}
      <div className="grid grid-cols-1 gap-2 @sm:grid-cols-3">
        {CATEGORIES.map((category) => {
          const Icon = category.icon;
          const count = counts[category.group];
          const percentage = trackedTotal > 0 ? Math.round((count / trackedTotal) * 100) : 0;
          return (
            <div
              key={category.group}
              className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 @sm:block @sm:p-3"
            >
              <div className="flex min-w-0 items-center gap-2 text-foreground/80">
                <Icon className="h-4 w-4 shrink-0" style={{ color: category.color }} />
                <span className="truncate text-xs">{category.label}</span>
              </div>
              <div className="flex items-baseline gap-2 @sm:mt-2 @sm:items-end @sm:justify-between">
                <span className="text-lg tabular-nums text-foreground @sm:text-xl">{count}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{percentage}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {counts.other > 0 && (
        <p className="text-xs text-muted-foreground">
          {counts.other} linked or embedded asset{counts.other === 1 ? " is" : "s are"} not included in this ratio.
        </p>
      )}
    </div>
  );
}
