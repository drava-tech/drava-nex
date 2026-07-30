import React from "react";
import { uptimeSeries, stats } from "@/app/(dashboard)/_data/dashboard-demo";

const WIDTH = 480;
const HEIGHT = 64;

export function HeroOverview() {
  const max = 100;
  const min = 60;
  const points = uptimeSeries.map((d, i) => {
    const x = (WIDTH * i) / (uptimeSeries.length - 1);
    const y = HEIGHT - ((d.value - min) / (max - min)) * HEIGHT;
    return { x, y };
  });
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath =
    `M${first.x},${HEIGHT} ` + points.map((p) => `L${p.x},${p.y}`).join(" ") + ` L${last.x},${HEIGHT} Z`;

  return (
    <div className="relative flex h-full flex-col justify-between gap-6 overflow-hidden p-6">
      <div>
        <p className="text-sm font-medium text-blue-300">Live overview</p>
        <h2 className="mt-1 text-3xl font-bold tracking-tight text-white">
          Signage Network
        </h2>
        <p className="mt-1.5 text-sm text-slate-400">{stats.screens.breakdown}</p>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Screen uptime trend, last 7 days"
      >
        <defs>
          <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#heroFill)" />
        <path
          d={linePath}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 6px var(--chart-1))" }}
        />
      </svg>
    </div>
  );
}
