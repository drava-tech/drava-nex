"use client";

import React from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Card, cn } from "@platform/ui";
import { Slider, Switch } from "./controls";

export interface SpeakerState {
  on: boolean;
  volume: number;
  muted: boolean;
}

const BARS = [0.45, 0.8, 0.35, 1, 0.6, 0.9, 0.5, 0.75, 0.4];

function EqualizerVisual({ active }: { active: boolean }) {
  // 9 bars in a 120×64 canvas. When active, animate height/y with staggered
  // SMIL so it reads as a live equalizer; otherwise show a frozen waveform.
  const W = 120;
  const H = 64;
  const barW = 8;
  const gap = (W - BARS.length * barW) / (BARS.length - 1);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full text-indigo-500 dark:text-indigo-400"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {BARS.map((b, i) => {
        const x = i * (barW + gap);
        const baseH = 12 + b * (H - 16);
        const baseY = H - baseH;
        const peak = H - 12;
        const dur = 0.7 + (i % 4) * 0.18;
        const begin = `${(i * 0.13).toFixed(2)}s`;
        return (
          <rect
            key={i}
            x={x}
            y={active ? undefined : baseY}
            width={barW}
            height={active ? undefined : baseH}
            rx={barW / 2}
            fill="currentColor"
            opacity={0.85}
          >
            {active && (
              <>
                <animate
                  attributeName="height"
                  values={`${10};${peak};${baseH};${peak * 0.6};${10}`}
                  dur={`${dur}s`}
                  begin={begin}
                  repeatCount="indefinite"
                  calcMode="spline"
                  keySplines="0.4 0 0.2 1; 0.4 0 0.2 1; 0.4 0 0.2 1; 0.4 0 0.2 1"
                  keyTimes="0;0.25;0.5;0.75;1"
                />
                <animate
                  attributeName="y"
                  values={`${H - 10};${H - peak};${H - baseH};${H - peak * 0.6};${H - 10}`}
                  dur={`${dur}s`}
                  begin={begin}
                  repeatCount="indefinite"
                  calcMode="spline"
                  keySplines="0.4 0 0.2 1; 0.4 0 0.2 1; 0.4 0 0.2 1; 0.4 0 0.2 1"
                  keyTimes="0;0.25;0.5;0.75;1"
                />
              </>
            )}
          </rect>
        );
      })}
    </svg>
  );
}

export function SpeakerCard({
  state,
  onChange,
}: {
  state: SpeakerState;
  onChange: (next: Partial<SpeakerState>) => void;
}) {
  const { on, volume, muted } = state;
  const live = on && !muted && volume > 0;

  return (
    <Card
      className={cn(
        "flex h-full flex-col gap-4 border-indigo-100 bg-indigo-50/60 p-5 shadow-sm transition-opacity dark:border-indigo-900/30 dark:bg-indigo-950/20",
        !on && "opacity-60"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-base leading-none">
            <span role="img" aria-label="Speaker">🔊</span>
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Speaker</p>
            <p className="text-xs text-muted-foreground">
              {on ? (muted ? "Muted" : "Now playing · Ambient Mix") : "Off"}
            </p>
          </div>
        </div>
        <Switch checked={on} onChange={(v) => onChange({ on: v })} accent="indigo" label="Speaker power" />
      </div>

      <div className="flex flex-1 items-center gap-5">
        {/* SVG equalizer */}
        <div className="flex h-20 w-28 shrink-0 items-end justify-center rounded-xl bg-white/60 p-3 dark:bg-white/5">
          <EqualizerVisual active={live} />
        </div>

        {/* Controls */}
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Volume</span>
            <span className="font-medium tabular-nums">{muted ? "Muted" : `${volume}%`}</span>
          </div>
          <Slider
            value={volume}
            onChange={(v) => onChange({ volume: v, muted: false })}
            accent="indigo"
            disabled={!on}
            ariaLabel="Volume"
          />
          <button
            type="button"
            disabled={!on}
            onClick={() => onChange({ muted: !muted })}
            className={cn(
              "inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              muted
                ? "border-indigo-200 bg-indigo-500/10 text-indigo-600 dark:border-indigo-900/40 dark:text-indigo-400"
                : "border-border text-muted-foreground hover:bg-accent",
              !on && "cursor-not-allowed opacity-50"
            )}
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            {muted ? "Unmute" : "Mute"}
          </button>
        </div>
      </div>
    </Card>
  );
}
