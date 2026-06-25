"use client";

import React from "react";
import { Snowflake, Fan, Wind, Minus, Plus } from "lucide-react";
import { Card, cn } from "@platform/ui";
import { Switch } from "./controls";

export type AcMode = "Cool" | "Fan" | "Auto";

export interface AcState {
  on: boolean;
  temp: number; // 16–30 °C
  mode: AcMode;
}

const MIN_TEMP = 16;
const MAX_TEMP = 30;
const COOL = "#38bdf8"; // sky-400
const WARM = "#f59e0b"; // amber-500

function AcGauge({ on, temp }: { on: boolean; temp: number }) {
  const size = 200;
  const c = size / 2;
  const r = 78;
  const circumference = 2 * Math.PI * r;
  const span = 0.75; // 270° arc, gap at the bottom
  const frac = (temp - MIN_TEMP) / (MAX_TEMP - MIN_TEMP);
  const color = temp >= 24 ? WARM : COOL;

  return (
    <div className="relative aspect-square w-full max-w-[230px]">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
        {/* track */}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          className="stroke-muted-foreground/15"
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${span * circumference} ${circumference}`}
          transform={`rotate(135 ${c} ${c})`}
        />
        {/* filled arc */}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={on ? color : "#a1a1aa"}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${frac * span * circumference} ${circumference}`}
          transform={`rotate(135 ${c} ${c})`}
          style={{ transition: "stroke-dasharray 0.4s ease, stroke 0.4s ease", opacity: on ? 1 : 0.5 }}
        />
      </svg>

      {/* center readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-5xl font-semibold tabular-nums tracking-tight transition-colors"
          style={{ color: on ? color : undefined }}
        >
          {temp}
          <span className="align-top text-xl text-muted-foreground">°C</span>
        </span>
        <span className="mt-1 text-xs text-muted-foreground">
          {on ? (temp >= 24 ? "Warm" : "Cooling") : "Off"}
        </span>
      </div>
    </div>
  );
}

const MODE_ICON: Record<AcMode, typeof Snowflake> = {
  Cool: Snowflake,
  Fan: Fan,
  Auto: Wind,
};

export function AcCard({
  state,
  onChange,
}: {
  state: AcState;
  onChange: (next: Partial<AcState>) => void;
}) {
  const { on, temp, mode } = state;
  const modes: AcMode[] = ["Cool", "Fan", "Auto"];

  const step = (delta: number) =>
    onChange({ temp: Math.max(MIN_TEMP, Math.min(MAX_TEMP, temp + delta)) });

  return (
    <Card
      className={cn(
        "flex h-full flex-col gap-4 border-sky-100 bg-sky-50/60 p-5 shadow-sm transition-opacity dark:border-sky-900/30 dark:bg-sky-950/20",
        !on && "opacity-60"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-base leading-none">
            <span role="img" aria-label="Air conditioner">❄️</span>
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Air Conditioner</p>
            <p className="text-xs text-muted-foreground">{on ? `${mode} mode` : "Off"}</p>
          </div>
        </div>
        <Switch checked={on} onChange={(v) => onChange({ on: v })} accent="sky" label="AC power" />
      </div>

      {/* gauge */}
      <div className="flex flex-1 items-center justify-center py-2">
        <AcGauge on={on} temp={temp} />
      </div>

      {/* stepper */}
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          disabled={!on || temp <= MIN_TEMP}
          onClick={() => step(-1)}
          aria-label="Decrease temperature"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-white text-foreground shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/5"
        >
          <Minus className="h-5 w-5" />
        </button>
        <span className="w-14 text-center text-sm text-muted-foreground">Temp</span>
        <button
          type="button"
          disabled={!on || temp >= MAX_TEMP}
          onClick={() => step(1)}
          aria-label="Increase temperature"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-white text-foreground shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/5"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      {/* mode chips */}
      <div className="flex justify-center gap-1.5">
        {modes.map((m) => {
          const Icon = MODE_ICON[m];
          return (
            <button
              key={m}
              type="button"
              disabled={!on}
              onClick={() => onChange({ mode: m })}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                mode === m
                  ? "border-sky-200 bg-sky-500/10 text-sky-600 dark:border-sky-900/40 dark:text-sky-400"
                  : "border-border text-muted-foreground hover:bg-accent",
                !on && "cursor-not-allowed opacity-50"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {m}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
