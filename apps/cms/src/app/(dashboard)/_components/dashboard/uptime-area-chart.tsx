"use client";

import React, { useId, useState } from "react";
import type { DailyUptimePoint } from "@platform/db";

const WIDTH = 640;
const HEIGHT = 220;
const PAD_X = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

/** Below this share of a full day's samples, a bar is a partial record. */
const PARTIAL_DAY_RATIO = 0.5;

/**
 * Screen uptime over the last seven complete days.
 *
 * Every point can be null — a day the API was not running, or one before
 * recording started — and the path is broken across those rather than drawn
 * through zero, because "we have no data" and "no screens were on" are very
 * different statements to make to an operator.
 *
 * This used to render a hardcoded seven-element array, which let three
 * assumptions go unnoticed: it divided by `length - 1` (NaN on a single point),
 * dereferenced points[0] without a guard (a crash on an empty series, i.e. the
 * first day of recording), and floored the y-axis at 60 to make invented
 * variation look dramatic — which pushed any genuinely bad day off the bottom
 * of the box. All three are fixed here.
 */
export function UptimeAreaChart({
  series,
  expectedSamplesPerDay,
  isSample = false,
}: {
  series: DailyUptimePoint[];
  /** Ticks a fully-recorded day should have, for the partial-day marker. */
  expectedSamplesPerDay: number;
  /** Values are placeholders — render at half strength so it reads as such. */
  isSample?: boolean;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const known = series.filter((d) => d.value !== null);

  if (known.length === 0) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm text-slate-400">No uptime recorded yet</p>
        <p className="text-xs text-slate-500">
          The first daily figure appears once a full day has been sampled.
        </p>
      </div>
    );
  }

  const max = 100;
  const min = 0;
  const innerW = WIDTH - PAD_X * 2;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baseline = PAD_TOP + innerH;

  // Guarded divisor: a single point would otherwise divide by zero and put NaN
  // into the path's `d` attribute, which renders as nothing at all.
  const steps = Math.max(1, series.length - 1);

  const points = series.map((d, i) => {
    const x = PAD_X + (innerW * i) / steps;
    const y = d.value === null ? null : PAD_TOP + innerH - ((d.value - min) / (max - min)) * innerH;
    return { ...d, x, y };
  });

  // Contiguous runs of known values — one path each, so a gap stays a gap.
  const runs: { x: number; y: number; value: number }[][] = [];
  let run: { x: number; y: number; value: number }[] = [];
  for (const p of points) {
    if (p.y === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push({ x: p.x, y: p.y, value: p.value as number });
    }
  }
  if (run.length > 0) runs.push(run);

  const active = hover !== null ? points[hover] : null;

  return (
    // Half strength for placeholders: the shape reads at a glance, but it is
    // visibly not the same thing as a measured line. The badge in the card
    // header says so in words.
    <div className={`relative w-full ${isSample ? "opacity-50" : ""}`}>
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
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          );
        })}

        {runs.map((r, ri) => {
          const line = r.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
          const area =
            `M${r[0]!.x},${baseline} ` +
            r.map((p) => `L${p.x},${p.y}`).join(" ") +
            ` L${r[r.length - 1]!.x},${baseline} Z`;
          return (
            <g key={ri}>
              <path d={area} fill={`url(#${gradientId})`} />
              <path
                d={line}
                fill="none"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{ filter: "drop-shadow(0 0 6px var(--chart-1))" }}
              />
              {/* A run of one has no line to see — mark it so a lone recorded
                  day isn't an invisible chart. */}
              {r.length === 1 && (
                <circle cx={r[0]!.x} cy={r[0]!.y} r={3.5} fill="var(--chart-1)" />
              )}
            </g>
          );
        })}

        {/* active marker */}
        {active && active.y !== null && (
          <>
            <line
              x1={active.x}
              x2={active.x}
              y1={PAD_TOP}
              y2={PAD_TOP + innerH}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={1}
            />
            <circle
              cx={active.x}
              cy={active.y}
              r={4}
              fill="var(--chart-1)"
              stroke="#05070d"
              strokeWidth={2}
              style={{ filter: "drop-shadow(0 0 8px var(--chart-1))" }}
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
              className={p.value === null ? "fill-slate-600 text-[11px]" : "fill-slate-400 text-[11px]"}
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-[#0b0f1a]/90 px-2 py-1 text-xs shadow-lg backdrop-blur-sm"
          style={{
            left: `${(active.x / WIDTH) * 100}%`,
            top: `${((active.y ?? baseline) / HEIGHT) * 100}%`,
          }}
        >
          {active.value === null ? (
            <span className="text-slate-400">Not recorded</span>
          ) : (
            <>
              <span className="font-medium text-white">{active.value}%</span>{" "}
              <span className="text-slate-400">online</span>
              {/* A day with a handful of samples is not the same claim as a day
                  with a full set — say so rather than averaging the difference
                  away. */}
              {active.sampleCount < expectedSamplesPerDay * PARTIAL_DAY_RATIO && (
                <span className="text-amber-400"> · partial</span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
