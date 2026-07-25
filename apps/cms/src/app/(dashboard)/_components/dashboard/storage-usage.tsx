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

const SIZE = 120;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUM = 2 * Math.PI * RADIUS;

export function StorageUsage() {
  const usedGb = storageByType.reduce((sum, s) => sum + s.gb, 0);
  const usedPct = Math.round((usedGb / storageTotalGb) * 100);
  const dash = (usedPct / 100) * CIRCUM;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-5">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="-rotate-90"
            role="img"
            aria-label="Total storage used"
          >
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={STROKE}
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={STROKE}
              strokeDasharray={`${dash} ${CIRCUM - dash}`}
              strokeLinecap="round"
              style={{ filter: "drop-shadow(0 0 8px var(--chart-1))" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold tabular-nums text-white">{usedPct}%</span>
            <span className="text-[10px] text-slate-400">used</span>
          </div>
        </div>

        <div className="flex-1 space-y-3">
          {storageByType.map((s) => {
            const pct = Math.round((s.gb / storageTotalGb) * 100);
            return (
              <div key={s.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{s.label}</span>
                  <span className="tabular-nums text-slate-400">{s.gb.toFixed(2)} GB</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: s.colorVar,
                      boxShadow: `0 0 8px ${s.colorVar}`,
                    }}
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
        <ul className="flex flex-col gap-3">
          {recentUploads.map((upload) => {
            const Icon = typeIcon[upload.type];
            return (
              <li key={upload.id} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{upload.name}</p>
                  <p className="text-xs text-slate-400">
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
