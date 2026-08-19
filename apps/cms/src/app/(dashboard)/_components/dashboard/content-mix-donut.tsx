import React from "react";
import { contentMix } from "@/app/(dashboard)/_data/dashboard-demo";
import { LiquidPill } from "./liquid-pill";

const SIZE = 200;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUM = 2 * Math.PI * RADIUS;
const GAP = 4; // px gap between segments along the circumference

export function ContentMixDonut() {
  const total = contentMix.reduce((sum, s) => sum + s.value, 0);

  let offset = 0;
  const segments = contentMix.map((s) => {
    const fraction = s.value / total;
    const length = Math.max(fraction * CIRCUM - GAP, 0);
    const seg = {
      ...s,
      dashArray: `${length} ${CIRCUM - length}`,
      dashOffset: -offset,
    };
    offset += fraction * CIRCUM;
    return seg;
  });

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="-rotate-90"
          role="img"
          aria-label="Content mix by template type"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={STROKE}
          />
          {segments.map((s) => (
            <circle
              key={s.label}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={s.colorVar}
              strokeWidth={STROKE}
              strokeDasharray={s.dashArray}
              strokeDashoffset={s.dashOffset}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 8px ${s.colorVar})` }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums text-white">{total}</span>
          <span className="text-xs text-slate-400">deployed</span>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {contentMix.map((s) => (
          <LiquidPill key={s.label}>
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: s.colorVar }}
            />
            {s.label}
            <span className="text-slate-300 tabular-nums">
              {Math.round((s.value / total) * 100)}%
            </span>
          </LiquidPill>
        ))}
      </div>
    </div>
  );
}
