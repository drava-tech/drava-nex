import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Speaker as SpeakerIcon, Plug, VolumeX, Minus, Plus } from "lucide-react";
import { Badge } from "@platform/ui";
import { Switch } from "./controls";
import { noProp } from "./utils";

// Buttons only, no drag — a draggable-looking bar invites people to try
// dragging it as a slider, which is exactly what this replaced. Small step
// so repeated taps land precisely instead of overshooting.
const VOLUME_STEP = 2;

export default function AudioContent({ isExpanded, state, actions }: any) {
  const inputOptions = ["HDMI", "AUX", "Bluetooth"] as const;
  const currentInput = state.input ?? inputOptions[0];
  const [showInputOptions, setShowInputOptions] = useState(false);

  const adjustVolume = (delta: number) => {
    const base = state.muted ? 0 : state.volume;
    actions.setVolume(Math.max(0, Math.min(100, base + delta)));
    actions.setMuted(false);
  };

  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className={`flex justify-between items-start shrink-0 ${isExpanded ? "mb-4" : "mb-2"}`}>
        <div className="flex items-center gap-2">
          <div className={`${isExpanded ? "w-8 h-8" : "w-7 h-7"} rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0`}>
            <SpeakerIcon className={isExpanded ? "w-4 h-4" : "w-3.5 h-3.5"} />
          </div>
          <h3 className={`${isExpanded ? "text-lg" : "text-base"} font-semibold tracking-tight`}>Audio</h3>
        </div>
        <div className={`flex items-center ${isExpanded ? "gap-3" : "gap-2"}`}>
          <Badge variant="secondary" className={`${isExpanded ? "" : "hidden xl:inline-flex"} border-0 bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-slate-300 shadow-none font-bold uppercase text-[10px] tracking-widest`}>{state.power ? "Playing" : "Off"}</Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      <div className={`flex-1 flex flex-col justify-center transition-all duration-150 ${!state.power ? 'opacity-40 grayscale-[0.8] pointer-events-none' : ''}`}>
        {!isExpanded ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 leading-none">
              <span className="text-3xl font-black md:text-[2rem]">{state.muted ? "Mute" : `${state.volume}%`}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Volume</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#1B006D] to-[#8A5CFF] transition-[width] duration-150 ease-out"
                style={{ width: `${state.power && !state.muted ? state.volume : 0}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0 w-full flex-col gap-4 lg:gap-6 py-1" onClick={noProp}>
            <div className="grid grid-cols-1 xl:grid-cols-[112px_112px] gap-2 lg:gap-3 items-stretch shrink-0">
              <div className="relative z-30">
                <button
                  onClick={(e) => { noProp(e); setShowInputOptions((open) => !open); }}
                  className="h-12 lg:h-16 w-full rounded-xl border border-blue-500/30 bg-blue-500/10 px-2 py-2 flex flex-col items-center justify-center gap-1 text-blue-500 font-bold transition-all hover:bg-blue-500/15 shadow-[0_0_14px_rgba(59,130,246,0.18)]"
                >
                  <Plug className="w-4 h-4 lg:w-5 lg:h-5" />
                  <span className="text-[8px] lg:text-[10px] uppercase tracking-widest">Input {currentInput}</span>
                </button>
                <AnimatePresence>
                  {showInputOptions && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                      className="absolute left-0 top-full z-50 mt-2 w-40 rounded-xl border border-blue-500/25 bg-card/95 p-1.5 shadow-2xl backdrop-blur"
                    >
                      <div className="grid gap-1">
                        {inputOptions.map((input) => (
                          <button
                            key={input}
                            onClick={(e) => { noProp(e); actions.setInput(input); setShowInputOptions(false); }}
                            className={`h-8 rounded-lg border px-2 text-[10px] font-bold uppercase tracking-widest transition-all ${
                              currentInput === input
                                ? 'bg-blue-500/15 text-blue-500 border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.22)]'
                               : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/60'
                            }`}
                          >
                            {input}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <button
                onClick={(e) => { noProp(e); actions.setMuted(!state.muted); }}
                className={`h-12 lg:h-16 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all ${
                  state.muted
                    ? 'bg-red-500/10 text-red-500 border-red-500/40 shadow-[0_0_14px_rgba(239,68,68,0.25)]'
                    : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/50'
                }`}
              >
                <VolumeX className="w-4 h-4 lg:w-5 lg:h-5" />
                <span className="text-[8px] lg:text-[10px] uppercase tracking-widest">{state.muted ? "Muted" : "Mute"}</span>
              </button>
            </div>

            <div className="min-w-0 lg:flex lg:flex-1 lg:min-h-0 lg:flex-col">
              <div className="flex items-start justify-between mb-2 lg:mb-4 shrink-0">
                <span className="text-3xl lg:text-5xl font-black">{state.muted ? 0 : state.volume}<span className="text-lg lg:text-2xl text-blue-500/50">%</span></span>
                <span className="text-[10px] lg:text-xs font-bold text-muted-foreground uppercase tracking-widest">Master Volume</span>
              </div>
              <div className="flex-1 flex items-center justify-center gap-6 lg:min-h-0">
                <motion.button
                  whileTap={{ scale: 0.86 }}
                  onClick={(e) => { noProp(e); adjustVolume(-VOLUME_STEP); }}
                  style={{ touchAction: "manipulation" }}
                  className="h-16 w-16 lg:h-20 lg:w-20 rounded-full border border-blue-500/30 bg-gradient-to-b from-blue-500/20 to-blue-500/5 flex items-center justify-center text-blue-500 transition-colors hover:from-blue-500/25 hover:to-blue-500/10 shadow-[0_2px_16px_rgba(59,130,246,0.25),inset_0_1px_0_rgba(255,255,255,0.08)]"
                  aria-label="Decrease volume"
                >
                  <Minus className="w-6 h-6 lg:w-7 lg:h-7" strokeWidth={2.75} />
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.86 }}
                  onClick={(e) => { noProp(e); adjustVolume(VOLUME_STEP); }}
                  style={{ touchAction: "manipulation" }}
                  className="h-16 w-16 lg:h-20 lg:w-20 rounded-full border border-blue-500/30 bg-gradient-to-b from-blue-500/20 to-blue-500/5 flex items-center justify-center text-blue-500 transition-colors hover:from-blue-500/25 hover:to-blue-500/10 shadow-[0_2px_16px_rgba(59,130,246,0.25),inset_0_1px_0_rgba(255,255,255,0.08)]"
                  aria-label="Increase volume"
                >
                  <Plus className="w-6 h-6 lg:w-7 lg:h-7" strokeWidth={2.75} />
                </motion.button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
