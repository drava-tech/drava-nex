import React from "react";
import { uptimeSeries } from "@/app/(dashboard)/_data/dashboard-demo";

const SIZE = 168;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUM = 2 * Math.PI * RADIUS;

export function UptimeRing() {
  const avg = Math.round(
    uptimeSeries.reduce((sum, d) => sum + d.value, 0) / uptimeSeries.length
  );
  const dash = (avg / 100) * CIRCUM;

  return (
    <div className="flex flex-col items-center justify-center gap-1 py-2">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="-rotate-90"
          role="img"
          aria-label="Average uptime over the last 7 days"
        >
          <defs>
            <linearGradient id="uptimeRingGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" />
              <stop offset="100%" stopColor="var(--chart-2)" />
            </linearGradient>
          </defs>
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
            stroke="url(#uptimeRingGrad)"
            strokeWidth={STROKE}
            strokeDasharray={`${dash} ${CIRCUM - dash}`}
            strokeLinecap="round"
            style={{ filter: "drop-shadow(0 0 10px var(--chart-1))" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums text-white">{avg}%</span>
          <span className="text-xs text-slate-400">avg uptime</span>
        </div>
      </div>
      <p className="text-xs text-slate-500">Last 7 days</p>
    </div>
  );
}
