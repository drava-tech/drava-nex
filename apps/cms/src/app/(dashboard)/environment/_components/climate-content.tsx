import React from "react";
import { Thermometer, Plus, Minus } from "lucide-react";
import { Badge } from "@platform/ui";
import { Switch } from "./controls";
import { getTempColor, noProp } from "./utils";

export default function ClimateContent({ isExpanded, state, actions }: any) {
  // The AC only accepts a setpoint in cool/heat; auto/fan/dry have no temp in
  // its codebook, so don't offer dial controls the appliance will ignore.
  const mode = String(state.mode ?? "").toLowerCase();
  const tempApplies = mode === "cool" || mode === "heat";

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
          <div className="flex-1 min-h-0 w-full flex items-center justify-between gap-4 md:gap-8 lg:gap-12 py-2 max-w-4xl mx-auto">
            {/* Left: Mode Selection */}
            <div className="flex flex-col gap-2.5 md:gap-3.5 shrink-0 w-24 md:w-28 lg:w-32">
              {(["Cool", "Heat", "Auto", "Fan", "Dry"] as const).map((m) => {
                const isActive = state.mode?.toLowerCase() === m.toLowerCase();
                return (
                  <button
                    key={m}
                    onClick={(e) => { noProp(e); actions.setMode(m); }}
                    className={`h-10 md:h-12 lg:h-14 rounded-2xl border px-2 text-xs md:text-sm font-bold uppercase tracking-widest transition-all duration-300 ${
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
            <div className="flex min-h-0 items-center justify-center flex-1 h-full max-h-[320px] sm:max-h-[380px] md:max-h-[440px] lg:max-h-[500px]">
              <div className="relative aspect-square h-full max-h-full max-w-full flex items-center justify-center shrink-0">
                {Array.from({ length: 48 }).map((_, i) => {
                  const tickTemp = 15 + (i / 3);
                  const isActive = tickTemp <= state.temp;
                  return (
                    <div key={i} className="absolute inset-0 pointer-events-none" style={{ transform: `rotate(${i * 7.5}deg)` }}>
                      <div className={`w-[2.5px] md:w-[3px] h-3.5 md:h-5 mx-auto rounded-full transition-colors duration-500 ${isActive
                        ? (state.temp > 24 ? "bg-orange-500 shadow-[0_0_10px_#f97316]" : "bg-cyan-500 shadow-[0_0_10px_#06b6d4]")
                        : "bg-muted-foreground/20"
                      }`} />
                    </div>
                  );
                })}
                <div className="relative w-[76%] h-[76%] rounded-full bg-card shadow-2xl flex flex-col items-center justify-center z-10 border border-border">
                  <div className={`absolute inset-3 rounded-full blur-2xl opacity-20 transition-colors duration-1000 ${state.temp > 24 ? "bg-orange-500" : "bg-cyan-500"} animate-pulse`} />
                  <span className={`text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b ${getTempColor(state.temp)} relative z-10 select-none`}>
                    {state.temp}°
                  </span>
                  <span className="text-[10px] md:text-xs font-black text-muted-foreground tracking-widest uppercase mt-1 md:mt-2 relative z-10 select-none">Target</span>
                </div>
              </div>
            </div>

            {/* Right: Plus and Minus Controls */}
            <div className={`flex flex-col gap-4 md:gap-6 shrink-0 w-24 md:w-28 lg:w-32 items-center justify-center ${tempApplies ? "" : "opacity-40 pointer-events-none"}`}>
              <button
                onClick={(e) => { noProp(e); actions.setTemp(Math.min(30, state.temp + 1)); }}
                className="w-14 h-14 md:w-16 md:h-16 lg:w-20 lg:h-20 rounded-2xl md:rounded-3xl border border-border bg-muted/30 hover:bg-muted/60 text-foreground flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-all duration-150"
                aria-label="Increase temperature"
              >
                <Plus className="w-7 h-7 md:w-8 md:h-8 lg:w-9 lg:h-9" />
              </button>
              <button
                onClick={(e) => { noProp(e); actions.setTemp(Math.max(16, state.temp - 1)); }}
                className="w-14 h-14 md:w-16 md:h-16 lg:w-20 lg:h-20 rounded-2xl md:rounded-3xl border border-border bg-muted/30 hover:bg-muted/60 text-foreground flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-all duration-150"
                aria-label="Decrease temperature"
              >
                <Minus className="w-7 h-7 md:w-8 md:h-8 lg:w-9 lg:h-9" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
