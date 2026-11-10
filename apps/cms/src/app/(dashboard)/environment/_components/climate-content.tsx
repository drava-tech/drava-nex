import React from "react";
import { Thermometer, Plus, Minus } from "lucide-react";
import { Badge } from "@platform/ui";
import { Switch } from "./controls";
import { noProp } from "./utils";

/** 270° arc, r=88 around (100,100): bottom-left → over the top → bottom-right. */
const ARC = "M 37.77 162.23 A 88 88 0 1 1 162.23 162.23";

export default function ClimateContent({ isExpanded, state, actions }: any) {
  const mode = String(state.mode ?? "").toLowerCase();
  const tempPct = Math.min(100, Math.max(0, ((state.temp - 16) / 14) * 100));

  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className={`flex justify-between items-start shrink-0 ${isExpanded ? "mb-4 md:mb-6" : "mb-2"}`}>
        <div className="flex items-center gap-2">
          <div className={`${isExpanded ? "w-8 h-8" : "w-7 h-7"} rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0`}>
            <Thermometer className={isExpanded ? "w-4 h-4" : "w-3.5 h-3.5"} />
          </div>
          <h3 className={`${isExpanded ? "text-lg" : "text-base"} font-semibold tracking-tight`}>Climate</h3>
        </div>
        <div className={`flex items-center ${isExpanded ? "gap-3" : "gap-2"}`}>
          <Badge variant="secondary" className={`${isExpanded ? "" : "hidden xl:inline-flex"} border-0 bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-slate-300 shadow-none font-bold uppercase text-[10px] tracking-widest`}>{state.power ? "Online" : "Off"}</Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      <div className={`flex-1 min-h-0 flex flex-col justify-center transition-all duration-150 ${!state.power ? "opacity-40 grayscale-[0.8] pointer-events-none" : ""}`}>
        {!isExpanded ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 leading-none">
              <span className="text-3xl font-black md:text-[2rem]">{state.temp}&deg;</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{state.mode}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                style={{ width: `${((state.temp - 16) / 14) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          /* ponytail: responsive layout uses flex-col on <sm screens and flex-row on sm+ so dial and controls never squish or overflow */
          <div className="flex-1 min-h-0 w-full flex flex-col sm:flex-row items-center justify-between gap-3 md:gap-4 lg:gap-6 py-1 max-w-4xl mx-auto overflow-y-auto sm:overflow-visible">
            {/* Left/Top: Mode Selection */}
            <div className="flex flex-row flex-wrap sm:flex-col justify-center gap-1.5 sm:gap-2 md:gap-2.5 shrink-0 w-full sm:w-[4.5rem] md:w-20 lg:w-24">
              {(["Cool", "Heat", "Auto", "Fan", "Dry"] as const).map((m) => {
                const isActive = state.mode?.toLowerCase() === m.toLowerCase();
                return (
                  <button
                    key={m}
                    onClick={(e) => { noProp(e); actions.setMode(m); }}
                    className={`h-8 sm:h-9 md:h-10 lg:h-11 flex-1 sm:flex-none rounded-full px-1.5 text-[10px] sm:text-[11px] md:text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                      isActive
                        ? "btn-active"
                        : "bg-[#262626] text-white shadow-[var(--pill-shadow)] hover:bg-[#333333]"
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>

            {/* Center: Temperature Dial — an open 270° arc (gap at the bottom)
                that fills from bottom-left with the target temperature, the
                value in the middle and −/+ sitting in the gap.
                min-w-0 so this column can give way when the card is narrow.
                The dial is aspect-square sized from its *height*, so each
                max-h below is kept at or under the width this column actually
                gets at that breakpoint — otherwise max-w-full clamps the width
                and the dial renders as a squashed oval. */}
            <div className="flex min-h-0 min-w-0 items-center justify-center flex-1 w-full h-full max-h-[200px] sm:max-h-[260px] md:max-h-[300px] lg:max-h-[200px] xl:max-h-[280px] 2xl:max-h-[340px]">
              <div className="relative aspect-square h-full max-h-full max-w-full shrink-0">
                {/* Disc inside the arc, same surface + shadow as the mode and ± buttons. */}
                <div className="absolute inset-[16%] rounded-full bg-[#262626] shadow-[var(--pill-shadow)]" />
                <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full" aria-hidden>
                  <defs>
                    <linearGradient id="climate-arc" gradientUnits="userSpaceOnUse" x1="40" y1="165" x2="40" y2="70">
                      <stop offset="0%" stopColor="#26331f" />
                      <stop offset="55%" stopColor="#5ea83a" />
                      <stop offset="100%" stopColor="#92ff5f" />
                    </linearGradient>
                  </defs>
                  <path d={ARC} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={4} strokeLinecap="round" />
                  <path
                    d={ARC}
                    fill="none"
                    stroke="url(#climate-arc)"
                    strokeWidth={4}
                    strokeLinecap="round"
                    pathLength={100}
                    strokeDasharray={`${tempPct} 100`}
                    style={{ transition: "stroke-dasharray 150ms ease-out" }}
                  />
                </svg>

                <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
                  <span className="text-5xl sm:text-6xl md:text-7xl font-light leading-none text-white">{state.temp}°</span>
                  <span className="mt-2 text-xs text-white/80">Target</span>
                </div>

              </div>
            </div>

            {/* Right/Bottom: Plus (+) and Minus (-) Temperature Controls */}
            <div className="flex flex-row sm:flex-col gap-3 md:gap-4 shrink-0 w-full sm:w-[4.5rem] md:w-20 lg:w-24 items-center justify-center">
              <button
                onClick={(e) => {
                  noProp(e);
                  if (mode !== "cool" && mode !== "heat") actions.setMode("Cool");
                  actions.setTemp(Math.min(30, state.temp + 1));
                }}
                className="w-11 h-11 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-xl md:rounded-2xl bg-[#262626] text-white shadow-[var(--pill-shadow)] hover:bg-[#333333] flex flex-col items-center justify-center hover:scale-105 active:scale-95 transition-all duration-150"
                aria-label="Increase temperature"
                title="Increase temperature"
              >
                <Plus className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8" />
              </button>
              <button
                onClick={(e) => {
                  noProp(e);
                  if (mode !== "cool" && mode !== "heat") actions.setMode("Cool");
                  actions.setTemp(Math.max(16, state.temp - 1));
                }}
                className="w-11 h-11 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-xl md:rounded-2xl bg-[#262626] text-white shadow-[var(--pill-shadow)] hover:bg-[#333333] flex flex-col items-center justify-center hover:scale-105 active:scale-95 transition-all duration-150"
                aria-label="Decrease temperature"
                title="Decrease temperature"
              >
                <Minus className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
