"use client";

import React, { useId, useState } from "react";

const WIDTH = 640;
const HEIGHT = 240;
const PAD_X = 6;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;

interface AreaChartProps {
  data: { label: string; value: number }[];
  /** Suffix shown in the hover tooltip, e.g. "visitors". */
  unit?: string;
}

export function AreaChart({ data, unit = "" }: AreaChartProps) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(...data.map((d) => d.value)) * 1.1;
  const innerW = WIDTH - PAD_X * 2;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const points = data.map((d, i) => ({
    ...d,
    x: PAD_X + (innerW * i) / (data.length - 1),
    y: PAD_TOP + innerH - (d.value / max) * innerH,
  }));

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
        aria-label={`Chart, ${data.length} points from ${first.label} to ${last.label}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7b5bff" stopOpacity="0.95" />
            <stop offset="70%" stopColor="#4b32a8" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#2a1d5e" stopOpacity="0.25" />
          </linearGradient>
        </defs>

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={linePath}
          fill="none"
          stroke="#b9a4ff"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {active && (
          <>
            <line
              x1={active.x}
              x2={active.x}
              y1={PAD_TOP}
              y2={baseline}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={1}
            />
            <circle
              cx={active.x}
              cy={active.y}
              r={4}
              fill="#c9b8ff"
              stroke="#0d0a1f"
              strokeWidth={2}
            />
          </>
        )}

        {points.map((p, i) => (
          <g key={p.label}>
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
              y={HEIGHT - 6}
              textAnchor="middle"
              className="fill-[#8f89a6] text-[11px]"
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-[#6d5bc4]/50 bg-[#0d0a1f]/95 px-2 py-1 text-xs shadow-lg"
          style={{
            left: `${(active.x / WIDTH) * 100}%`,
            top: `${(active.y / HEIGHT) * 100}%`,
          }}
        >
          <span className="font-medium text-white">{active.value}</span>{" "}
          <span className="text-[#8f89a6]">{unit}</span>
        </div>
      )}
    </div>
  );
}
