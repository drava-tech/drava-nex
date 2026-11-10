"use client";

import React, { useId, useState } from "react";
import type { DailyUptimePoint } from "@platform/db";

const WIDTH = 640;
const HEIGHT = 220;
const PAD_X = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 6; // day labels are HTML below the chart now

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
      <div className="flex h-40 flex-col items-center justify-center gap-1 text-center sm:h-48 lg:h-52">
        <p className="text-sm text-muted-foreground">No uptime recorded yet</p>
        <p className="text-xs text-muted-foreground">
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

  // Percent positions, so HTML on top of the chart (markers, tooltip, labels)
  // lines up with the SVG at any size.
  const pctX = (x: number) => `${(x / WIDTH) * 100}%`;
  const pctY = (y: number) => `${(y / HEIGHT) * 100}%`;

  return (
    // Half strength for placeholders: the shape reads at a glance, but it is
    // visibly not the same thing as a measured line. The badge in the card
    // header says so in words.
    <div className={`w-full ${isSample ? "opacity-50" : ""}`}>
      {/* A real height at every width: the SVG stretches to fill it (lines keep
          their weight via non-scaling-stroke), and anything that must stay
          round or readable — markers, tooltip, day labels — is HTML on top,
          instead of shrinking with a fixed-ratio drawing on a narrow card. */}
      <div className="relative h-40 w-full sm:h-48 lg:h-52">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="absolute inset-0 h-full w-full"
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
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
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
                  vectorEffect="non-scaling-stroke"
                  style={{ filter: "drop-shadow(0 0 6px var(--chart-1))" }}
                />
              </g>
            );
          })}

          {/* active marker line */}
          {active && active.y !== null && (
            <line
              x1={active.x}
              x2={active.x}
              y1={PAD_TOP}
              y2={PAD_TOP + innerH}
              stroke="var(--border)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* hover hit areas */}
          {points.map((p, i) => (
            <rect
              key={p.day}
              x={p.x - innerW / (points.length * 2)}
              y={0}
              width={innerW / points.length}
              height={HEIGHT}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>

        {/* A run of one has no line to see — mark it so a lone recorded day
            isn't an invisible chart. */}
        {runs
          .filter((r) => r.length === 1)
          .map((r, i) => (
            <span
              key={`lone-${i}`}
              aria-hidden
              className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--chart-1)]"
              style={{ left: pctX(r[0]!.x), top: pctY(r[0]!.y) }}
            />
          ))}

        {active && active.y !== null && (
          <span
            aria-hidden
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-[var(--chart-1)] shadow-[0_0_8px_var(--chart-1)]"
            style={{ left: pctX(active.x), top: pctY(active.y) }}
          />
        )}

        {active && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-popover/95 px-2 py-1 text-xs shadow-lg backdrop-blur-sm"
            style={{
              // Kept inside the card at the first and last day.
              left: `clamp(3.5rem, ${pctX(active.x)}, calc(100% - 3.5rem))`,
              top: `calc(${pctY(active.y ?? baseline)} - 6px)`,
            }}
          >
            {active.value === null ? (
              <span className="text-muted-foreground">Not recorded</span>
            ) : (
              <>
                <span className="font-medium text-foreground">{active.value}%</span>{" "}
                <span className="text-muted-foreground">online</span>
                {/* A day with a handful of samples is not the same claim as a day
                    with a full set — say so rather than averaging the difference
                    away. */}
                {active.sampleCount < expectedSamplesPerDay * PARTIAL_DAY_RATIO && (
                  <span className="text-warning"> · partial</span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Day labels, as text at a readable size rather than inside the drawing. */}
      <div className="relative mt-1 h-4 w-full">
        {points.map((p) => (
          <span
            key={p.day}
            className={`absolute -translate-x-1/2 text-[11px] ${p.value === null ? "text-muted-foreground/50" : "text-muted-foreground"}`}
            style={{ left: pctX(p.x) }}
          >
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
