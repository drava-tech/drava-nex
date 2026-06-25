import React from "react";
import { contentMix } from "@/app/(dashboard)/_data/dashboard-demo";

const SIZE = 160;
const STROKE = 20;
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
    <div className="flex items-center gap-6">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
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
            className="stroke-muted"
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
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{total}</span>
          <span className="text-xs text-muted-foreground">deployed</span>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-3">
        {contentMix.map((s) => (
          <li key={s.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: s.colorVar }}
              />
              {s.label}
            </span>
            <span className="font-medium tabular-nums text-muted-foreground">
              {Math.round((s.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
