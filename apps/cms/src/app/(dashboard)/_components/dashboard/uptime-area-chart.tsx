"use client";

import React, { useId, useState } from "react";
import { uptimeSeries } from "@/app/(dashboard)/_data/dashboard-demo";

const WIDTH = 640;
const HEIGHT = 220;
const PAD_X = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

export function UptimeAreaChart() {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const max = 100;
  const min = 60; // tighten the band so variation is visible
  const innerW = WIDTH - PAD_X * 2;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const points = uptimeSeries.map((d, i) => {
    const x = PAD_X + (innerW * i) / (uptimeSeries.length - 1);
    const y =
      PAD_TOP + innerH - ((d.value - min) / (max - min)) * innerH;
    return { ...d, x, y };
  });

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const baseline = PAD_TOP + innerH;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
    .join(" ");
  const areaPath =
    `M${first.x},${baseline} ` +
    points.map((p) => `L${p.x},${p.y}`).join(" ") +
    ` L${last.x},${baseline} Z`;

  const active = hover !== null ? points[hover] : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Screen uptime over the last 7 days"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* horizontal grid lines */}
        {[0, 0.5, 1].map((t) => {
          const y = PAD_TOP + innerH * t;
          return (
            <line
              key={t}
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={y}
              y2={y}
              className="stroke-border"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          );
        })}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={linePath}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* active marker */}
        {active && (
          <>
            <line
              x1={active.x}
              x2={active.x}
              y1={PAD_TOP}
              y2={PAD_TOP + innerH}
              className="stroke-border"
              strokeWidth={1}
            />
            <circle
              cx={active.x}
              cy={active.y}
              r={4}
              fill="var(--chart-1)"
              className="stroke-background"
              strokeWidth={2}
            />
          </>
        )}

        {/* hover hit areas + x labels */}
        {points.map((p, i) => (
          <g key={p.day}>
            <rect
              x={p.x - innerW / (points.length * 2)}
              y={0}
              width={innerW / points.length}
              height={HEIGHT}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
            <text
              x={p.x}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {p.day}
            </text>
          </g>
        ))}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2 py-1 text-xs shadow-md"
          style={{
            left: `${(active.x / WIDTH) * 100}%`,
            top: `${(active.y / HEIGHT) * 100}%`,
          }}
        >
          <span className="font-medium">{active.value}%</span>{" "}
          <span className="text-muted-foreground">online</span>
        </div>
      )}
    </div>
  );
}
