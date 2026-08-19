import React from "react";
import { Film, Layers, Radio, Slash } from "lucide-react";
import {
  screens,
  type ContentKind,
  type ScreenStatus,
} from "@/app/(dashboard)/_data/dashboard-demo";
import { LiquidPill } from "./liquid-pill";

const kindMeta: Record<ContentKind, { icon: typeof Layers; label: string }> = {
  portfolio: { icon: Layers, label: "Portfolio" },
  "live-stream": { icon: Radio, label: "Live" },
  media: { icon: Film, label: "Media" },
  none: { icon: Slash, label: "—" },
};

const statusMeta: Record<ScreenStatus, { label: string; color: string }> = {
  online: { label: "Online", color: "#10b981" },
  offline: { label: "Offline", color: "#f43f5e" },
  maintenance: { label: "Maintenance", color: "#f59e0b" },
};

export function ScreensList() {
  return (
    <ul className="flex flex-col divide-y divide-white/5">
      {screens.map((screen) => {
        const Kind = kindMeta[screen.contentKind].icon;
        const status = statusMeta[screen.status];
        return (
          <li key={screen.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300">
              <Kind className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{screen.name}</p>
              <p className="truncate text-xs text-slate-400">
                {screen.content} · {screen.location}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <LiquidPill>
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: status.color }}
                />
                {status.label}
              </LiquidPill>
              <span className="text-[11px] text-slate-500">{screen.lastSeen}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export const ScreensTable = ScreensList;

