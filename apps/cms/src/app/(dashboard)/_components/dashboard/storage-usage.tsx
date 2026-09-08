"use client";

import { FileText, Film, Image as ImageIcon, Link2, type LucideIcon } from "lucide-react";
import {
  dashboardMediaGroup,
  formatMediaBytes,
  groupMediaStats,
  useDashboardMedia,
  type DashboardMediaGroup,
} from "./media-live-data";

const typeIcon: Record<DashboardMediaGroup, LucideIcon> = {
  video: Film,
  image: ImageIcon,
  document: FileText,
  other: Link2,
};

const storageGroups = [
  { group: "video" as const, label: "Videos", color: "var(--chart-1)" },
  { group: "image" as const, label: "Images", color: "var(--chart-2)" },
  { group: "document" as const, label: "Documents", color: "var(--chart-3)" },
];

function formatUploadDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function StorageUsage() {
  const { total, totalBytes, byType, recent } = useDashboardMedia();
  const { bytes: bytesByGroup } = groupMediaStats(byType);
  const categorizedBytes =
    bytesByGroup.video + bytesByGroup.image + bytesByGroup.document;

  // Already newest-first and capped by the API — no client-side sort needed.
  const recentUploads = recent;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div className="space-y-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Stored media</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-white">{formatMediaBytes(totalBytes)}</p>
          <p className="mt-1 text-xs text-slate-400">
            {total} library asset{total === 1 ? "" : "s"}
          </p>
        </div>

        <div className="space-y-4">
          {storageGroups.map((item) => {
            const bytes = bytesByGroup[item.group];
            const percentage = categorizedBytes > 0 ? (bytes / categorizedBytes) * 100 : 0;
            return (
              <div key={item.group} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-300">{item.label}</span>
                  <span className="tabular-nums text-slate-400">
                    {formatMediaBytes(bytes)} · {Math.round(percentage)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full transition-[width] duration-300"
                    style={{ width: `${percentage}%`, backgroundColor: item.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Recent uploads
        </p>
        {recentUploads.length === 0 ? (
          <p className="py-6 text-sm text-slate-500">No media has been uploaded yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {recentUploads.map((upload) => {
              const Icon = typeIcon[dashboardMediaGroup(upload.type)];
              return (
                <li key={upload.id} className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{upload.name}</p>
                    <p className="text-xs text-slate-400">
                      {formatMediaBytes(upload.sizeBytes)} · {formatUploadDate(upload.createdAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
