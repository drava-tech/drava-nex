import React from "react";
import { FileText, Film, Image as ImageIcon, type LucideIcon } from "lucide-react";
import {
  recentUploads,
  storageByType,
  storageTotalGb,
  type MediaType,
} from "@/app/(dashboard)/_data/dashboard-demo";

const typeIcon: Record<MediaType, LucideIcon> = {
  video: Film,
  image: ImageIcon,
  document: FileText,
};

export function StorageUsage() {
  const usedGb = storageByType.reduce((sum, s) => sum + s.gb, 0);
  const usedPct = Math.round((usedGb / storageTotalGb) * 100);

  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">
            {usedGb.toFixed(1)} GB of {storageTotalGb} GB used
          </span>
          <span className="text-sm font-medium tabular-nums">{usedPct}%</span>
        </div>
        {/* segmented progress bar */}
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
          {storageByType.map((s) => (
            <div
              key={s.label}
              style={{
                width: `${(s.gb / storageTotalGb) * 100}%`,
                backgroundColor: s.colorVar,
              }}
            />
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          {storageByType.map((s) => (
            <li
              key={s.label}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: s.colorVar }}
              />
              {s.label}
              <span className="tabular-nums">{s.gb.toFixed(2)} GB</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent uploads
        </p>
        <ul className="flex flex-col gap-3">
          {recentUploads.map((upload) => {
            const Icon = typeIcon[upload.type];
            return (
              <li key={upload.id} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{upload.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {upload.size} · {upload.time}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
