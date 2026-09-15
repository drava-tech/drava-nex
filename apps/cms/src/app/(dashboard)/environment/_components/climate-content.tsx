import React from "react";
import { Thermometer, Plus, Minus } from "lucide-react";
import { Badge } from "@platform/ui";
import { Switch } from "./controls";
import { getTempColor, noProp } from "./utils";

export default function ClimateContent({ isExpanded, state, actions }: any) {
  const mode = String(state.mode ?? "").toLowerCase();

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
                className="h-full rounded-full bg-gradient-to-r from-[#1B006D] to-[#8A5CFF] transition-[width] duration-150 ease-out"
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
                    className={`h-8 sm:h-9 md:h-10 lg:h-11 flex-1 sm:flex-none rounded-lg sm:rounded-xl border px-1.5 text-[10px] sm:text-[11px] md:text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                      isActive
                        ? "bg-primary/10 text-primary border-primary/50 shadow-[0_0_16px_rgba(138,92,255,0.35)]"
                        : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>

            {/* Center: Temperature Dial */}
            {/* min-w-0 so this column can actually give way when the card is
                narrow (the side columns are shrink-0); without it the dial
                keeps its width and squeezes the +/- controls off the card.
                The dial is aspect-square sized from its *height*, so each
                max-h below is kept at or under the width this column actually
                gets at that breakpoint — otherwise max-w-full clamps the width
                and the dial renders as a squashed oval. lg is the tightest
                case, not the roomiest: at 1024px the card is only 68% of a
                narrow viewport, so it needs a smaller cap than xl/2xl. */}
            <div className="flex min-h-0 min-w-0 items-center justify-center flex-1 w-full h-full max-h-[200px] sm:max-h-[260px] md:max-h-[300px] lg:max-h-[200px] xl:max-h-[280px] 2xl:max-h-[340px]">
              <div className="relative aspect-square h-full max-h-full max-w-full flex items-center justify-center shrink-0">
                {Array.from({ length: 48 }).map((_, i) => {
                  const tickTemp = 15 + (i / 3);
                  const isActive = tickTemp <= state.temp;
                  return (
                    <div key={i} className="absolute inset-0 pointer-events-none" style={{ transform: `rotate(${i * 7.5}deg)` }}>
                      <div className={`w-[2px] sm:w-[2px] md:w-[2.5px] h-2.5 sm:h-3 md:h-4 mx-auto rounded-full transition-colors duration-500 ${isActive
                        ? (state.temp > 24 ? "bg-orange-500 shadow-[0_0_10px_#f97316]" : "bg-cyan-500 shadow-[0_0_10px_#06b6d4]")
                        : "bg-muted-foreground/20"
                      }`} />
                    </div>
                  );
                })}
                <div className="relative w-[76%] h-[76%] rounded-full bg-card shadow-2xl flex flex-col items-center justify-center z-10 border border-border">
                  <div className={`absolute inset-3 rounded-full blur-2xl opacity-20 transition-colors duration-1000 ${state.temp > 24 ? "bg-orange-500" : "bg-cyan-500"} animate-pulse`} />
                  <span className={`text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b ${getTempColor(state.temp)} relative z-10 select-none`}>
                    {state.temp}°
                  </span>
                  <span className="text-[10px] md:text-xs font-black text-muted-foreground tracking-widest uppercase mt-1 md:mt-2 relative z-10 select-none">Target</span>
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
                className="w-11 h-11 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-xl md:rounded-2xl border border-border bg-muted/30 hover:bg-muted/60 text-foreground flex flex-col items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-all duration-150"
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
                className="w-11 h-11 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-xl md:rounded-2xl border border-border bg-muted/30 hover:bg-muted/60 text-foreground flex flex-col items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-all duration-150"
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
