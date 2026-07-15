import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Thermometer, Wind, Flame } from "lucide-react";
import { Button, Badge } from "@platform/ui";
import { Switch, ClimateControlIcon } from "./controls";
import { getTempColor, noProp } from "./utils";

export default function ClimateContent({ isExpanded, state, actions }: any) {
  const [showTimerOptions, setShowTimerOptions] = useState(false);
  const [showFanOptions, setShowFanOptions] = useState(false);

  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className={`flex justify-between items-start shrink-0 ${isExpanded ? "mb-4" : "mb-2"}`}>
        <div className="flex items-center gap-2">
          <div className={`${isExpanded ? "w-8 h-8" : "w-7 h-7"} rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0`}>
            <Thermometer className={isExpanded ? "w-4 h-4" : "w-3.5 h-3.5"} />
          </div>
          <h3 className={`${isExpanded ? "text-lg" : "text-base"} font-semibold tracking-tight`}>Climate</h3>
        </div>
        <div className={`flex items-center ${isExpanded ? "gap-3" : "gap-2"}`}>
          <Badge variant={state.power ? "default" : "secondary"} className={`${isExpanded ? "" : "hidden xl:inline-flex"} bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest`}>{state.power ? "Online" : "Off"}</Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      <div className={`flex-1 min-h-0 flex flex-col justify-center transition-all duration-150 ${!state.power ? 'opacity-40 grayscale-[0.8] pointer-events-none' : ''}`}>
        {!isExpanded ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 leading-none">
              <span className="text-3xl font-black md:text-[2rem]">{state.temp}&deg;</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{state.mode}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${state.temp > 24 ? "bg-orange-500" : "bg-cyan-500"}`}
                style={{ width: `${((state.temp - 16) / 14) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 w-full overflow-visible grid grid-cols-1 lg:grid-cols-[minmax(210px,0.82fr)_minmax(0,1.18fr)] gap-4 lg:gap-8 py-1">
            <div className="flex min-h-0 items-center justify-center lg:justify-start lg:pl-4">
              <div className="relative w-40 h-40 md:w-52 md:h-52 lg:aspect-square lg:h-full lg:w-auto lg:min-h-52 lg:max-h-72 flex items-center justify-center shrink-0">
              {Array.from({ length: 48 }).map((_, i) => {
                const tickTemp = 15 + (i / 3);
                const isActive = tickTemp <= state.temp;
                return (
                  <div key={i} className="absolute inset-0 pointer-events-none" style={{ transform: `rotate(${i * 7.5}deg)` }}>
                    <div className={`w-[2px] h-3 mx-auto rounded-full transition-colors duration-500 ${isActive
                      ? (state.temp > 24 ? 'bg-orange-500 shadow-[0_0_8px_#f97316]' : 'bg-cyan-500 shadow-[0_0_8px_#06b6d4]')
                      : 'bg-muted-foreground/20'
                    }`} />
                  </div>
                );
              })}
              <div className="relative w-32 h-32 md:w-40 md:h-40 lg:h-[78%] lg:w-[78%] rounded-full bg-card shadow-2xl flex flex-col items-center justify-center z-10 border border-border">
                <div className={`absolute inset-3 rounded-full blur-xl opacity-20 transition-colors duration-1000 ${state.temp > 24 ? 'bg-orange-500' : 'bg-cyan-500'} animate-pulse`} />
                <span className={`text-5xl md:text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b ${getTempColor(state.temp)} relative z-10`}>
                  {state.temp}°
                </span>
                <span className="text-[9px] font-black text-muted-foreground tracking-widest uppercase mt-0.5 relative z-10">Target</span>
              </div>
              </div>
            </div>

            <div className="relative z-20 flex min-h-0 w-full max-w-[420px] lg:max-w-[480px] justify-self-end flex-col justify-center gap-3 lg:gap-5 pr-1">
              <div className="flex justify-end gap-2 lg:gap-3 shrink-0">
                <Button variant="outline" size="icon" className="w-10 h-10 lg:w-12 lg:h-12 rounded-full" onClick={(e) => { noProp(e); actions.setTemp(Math.max(16, state.temp - 1)); }}>
                  <Wind className="w-5 h-5 lg:w-6 lg:h-6" />
                </Button>
                <Button variant="outline" size="icon" className="w-10 h-10 lg:w-12 lg:h-12 rounded-full" onClick={(e) => { noProp(e); actions.setTemp(Math.min(30, state.temp + 1)); }}>
                  <Flame className="w-5 h-5 lg:w-6 lg:h-6" />
                </Button>
              </div>

              <div className="relative w-full shrink-0">
                <div className="grid grid-cols-2 gap-2 lg:gap-3">
                <button
                  onClick={(e) => { noProp(e); actions.setSwing(!state.swing); }}
                  className={`h-16 lg:h-20 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all duration-300 ${
                    state.swing
                      ? 'bg-cyan-500/10 text-cyan-500 border-cyan-500/50 shadow-[0_0_20px_rgba(6,182,212,0.6)]'
                      : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/50'
                  }`}
                >
                  <ClimateControlIcon type="swing" active={state.swing} />
                  <span className="text-[9px] uppercase tracking-widest">Swing</span>
                </button>

                <button
                  onClick={(e) => { noProp(e); setShowTimerOptions((open) => !open); setShowFanOptions(false); }}
                  className={`h-16 lg:h-20 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all duration-300 ${
                    state.timer
                      ? 'bg-violet-500/10 text-violet-500 border-violet-500/50 shadow-[0_0_20px_rgba(139,92,246,0.45)]'
                      : showTimerOptions
                        ? 'bg-muted/60 text-foreground border-border'
                        : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/50'
                  }`}
                >
                  <ClimateControlIcon type="timer" active={showTimerOptions || Boolean(state.timer)} />
                  <span className="text-[9px] uppercase tracking-widest">{state.timer ?? "Timer"}</span>
                </button>

                <button
                  onClick={(e) => { noProp(e); actions.setTurbo(!state.turbo); }}
                  className={`h-16 lg:h-20 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all duration-300 ${
                    state.turbo
                      ? 'bg-orange-500/10 text-orange-500 border-orange-500/50 shadow-[0_0_20px_rgba(249,115,22,0.55)]'
                      : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/50'
                  }`}
                >
                  <ClimateControlIcon type="turbo" active={state.turbo} />
                  <span className="text-[9px] uppercase tracking-widest">Turbo</span>
                </button>

                <button
                  onClick={(e) => { noProp(e); setShowFanOptions((open) => !open); setShowTimerOptions(false); }}
                  className={`h-16 lg:h-20 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all duration-300 ${
                    showFanOptions || Boolean(state.fanSpeed)
                      ? 'bg-blue-500/10 text-blue-500 border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.35)]'
                      : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/50'
                  }`}
                >
                  <ClimateControlIcon type="fan" active={showFanOptions || Boolean(state.fanSpeed)} />
                  <span className="text-[9px] uppercase tracking-widest leading-tight text-center">{state.fanSpeed ?? "Fan Speed"}</span>
                </button>
              </div>

              <AnimatePresence>
                {showTimerOptions && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                    className="absolute left-0 right-0 top-full z-40 mt-2 rounded-xl border border-violet-500/25 bg-card/95 p-2 shadow-2xl backdrop-blur"
                  >
                    <div className="grid grid-cols-5 gap-1.5">
                      {([null, "15m", "30min", "1 hr", "2 hr"] as const).map((timer) => (
                        <button
                          key={timer ?? "off"}
                          onClick={(e) => { noProp(e); actions.setTimer(timer); setShowTimerOptions(false); }}
                          className={`h-9 rounded-xl border px-1 text-[10px] font-bold tracking-widest transition-all ${
                            state.timer === timer
                              ? 'bg-violet-500/20 text-violet-500 border-violet-500/50'
                              : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/60'
                          }`}
                        >
                          {timer ?? "Off"}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {showFanOptions && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                    className="absolute left-0 right-0 top-full z-40 mt-2 rounded-xl border border-blue-500/25 bg-card/95 p-2 shadow-2xl backdrop-blur"
                  >
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["Low", "Med", "High"] as const).map((speed) => (
                        <button
                          key={speed}
                          onClick={(e) => { noProp(e); actions.setFanSpeed(speed); setShowFanOptions(false); }}
                          className={`h-9 rounded-xl border px-1 text-[10px] font-bold tracking-widest transition-all duration-300 ${
                            state.fanSpeed === speed
                              ? 'bg-blue-500/10 text-blue-500 border-blue-500/40 shadow-[0_0_12px_rgba(59,130,246,0.25)]'
                              : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/50'
                          }`}
                        >
                          {speed}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
