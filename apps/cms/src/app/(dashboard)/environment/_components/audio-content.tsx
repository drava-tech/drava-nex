import React from "react";
import { motion } from "framer-motion";
import { Speaker as SpeakerIcon, VolumeX, Volume2, Minus, Plus } from "lucide-react";
import { Badge } from "@platform/ui";
import { Switch } from "./controls";
import { noProp } from "./utils";

// Buttons only, no drag — a draggable-looking bar invites people to try
// dragging it as a slider, which is exactly what this replaced. Small step
// so repeated taps land precisely instead of overshooting.
const VOLUME_STEP = 2;

// Same surface + shadow as the Climate controls.
const CTRL_BTN = "bg-[#262626] text-white shadow-[var(--pill-shadow)] hover:bg-[#333333]";

export default function AudioContent({ isExpanded, state, actions }: any) {
  /* ponytail: input selector removed completely per user request; audio panel strictly provides Increase (+), Decrease (-), & Mute options */
  const adjustVolume = (delta: number) => {
    const base = state.muted ? 0 : state.volume;
    // setVolume already clears `muted`. An explicit setMuted(false) here would
    // also POST /api/audio/unmute concurrently with /api/audio/volume, and the
    // native helper's unmute restores the pre-mute level from _volumeBeforeMute
    // (apps/api/audio-helper/Program.cs) — so if it landed second it overwrote
    // the volume just set and the hardware echoed the old value straight back.
    actions.setVolume(Math.max(0, Math.min(100, base + delta)));
  };

  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className={`flex justify-between items-start shrink-0 ${isExpanded ? "mb-4" : "mb-2"}`}>
        <div className="flex items-center gap-2">
          <div className={`${isExpanded ? "w-8 h-8" : "w-7 h-7"} rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0`}>
            <SpeakerIcon className={isExpanded ? "w-4 h-4" : "w-3.5 h-3.5"} />
          </div>
          <h3 className={`${isExpanded ? "text-lg" : "text-base"} font-semibold tracking-tight`}>Audio</h3>
        </div>
        <div className={`flex items-center ${isExpanded ? "gap-3" : "gap-2"}`}>
          <Badge variant="secondary" className={`${isExpanded ? "" : "hidden xl:inline-flex"} border-0 bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-slate-300 shadow-none font-bold uppercase text-[10px] tracking-widest`}>{state.power ? "Playing" : "Off"}</Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      <div className={`flex-1 flex flex-col justify-center transition-all duration-150 ${!state.power ? "opacity-40 grayscale-[0.8] pointer-events-none" : ""}`}>
        {!isExpanded ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 leading-none">
              <span className="text-3xl font-black md:text-[2rem]">{state.muted ? "Mute" : `${state.volume}%`}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Volume</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                style={{ width: `${state.power && !state.muted ? state.volume : 0}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0 w-full flex-col justify-center items-center gap-6 py-4" onClick={noProp}>
            {/* Center Volume Number & Subtitle */}
            <div className="text-center">
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-6xl sm:text-7xl lg:text-8xl font-black tracking-tight text-white">
                  {state.muted ? 0 : state.volume}
                </span>
                <span className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white/60">%</span>
              </div>
              <p className="mt-1 text-[10px] sm:text-xs font-bold text-white/80 uppercase tracking-widest">
                Master Volume
              </p>
              {/* Which endpoint is actually being driven — reads "Unknown
                  Device" when the native audio bridge isn't connected, which is
                  otherwise indistinguishable from everything working. */}
              {state.device && (
                <p className="mt-0.5 truncate text-[10px] font-semibold text-white/50">
                  {state.device}
                </p>
              )}
            </div>

            {/* Volume Level Bar — same black → red as the Climate arc */}
            <div className="w-full max-w-sm h-2.5 rounded-full overflow-hidden p-0.5 bg-[#262626] shadow-[var(--pill-shadow)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#26331f] via-[#5ea83a] to-[#92ff5f] transition-all duration-150"
                style={{ width: `${state.power && !state.muted ? state.volume : 0}%` }}
              />
            </div>

            {/* Controls Row: Decrease (-), Mute Toggle, Increase (+) */}
            <div className="flex items-center justify-center gap-6 sm:gap-8 pt-2">
              {/* Decrease Volume Button */}
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={(e) => { noProp(e); adjustVolume(-VOLUME_STEP); }}
                style={{ touchAction: "manipulation" }}
                className={`h-16 w-16 sm:h-20 sm:w-20 rounded-2xl flex flex-col items-center justify-center transition-all ${CTRL_BTN}`}
                aria-label="Decrease volume"
              >
                <Minus className="w-7 h-7 sm:w-9 sm:h-9" strokeWidth={2.5} />
              </motion.button>

              {/* Mute Button */}
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={(e) => { noProp(e); actions.setMuted(!state.muted); }}
                style={{ touchAction: "manipulation" }}
                className={`h-16 w-16 sm:h-20 sm:w-20 rounded-2xl flex flex-col items-center justify-center gap-1 font-bold transition-all ${
                  state.muted ? "btn-active" : CTRL_BTN
                }`}
                aria-label={state.muted ? "Unmute" : "Mute"}
              >
                {state.muted ? <VolumeX className="w-6 h-6 sm:w-7 sm:h-7" /> : <Volume2 className="w-6 h-6 sm:w-7 sm:h-7" />}
                <span className="text-[9px] sm:text-[10px] uppercase tracking-wider font-bold">
                  {state.muted ? "Muted" : "Mute"}
                </span>
              </motion.button>

              {/* Increase Volume Button */}
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={(e) => { noProp(e); adjustVolume(VOLUME_STEP); }}
                style={{ touchAction: "manipulation" }}
                className={`h-16 w-16 sm:h-20 sm:w-20 rounded-2xl flex flex-col items-center justify-center transition-all ${CTRL_BTN}`}
                aria-label="Increase volume"
              >
                <Plus className="w-7 h-7 sm:w-9 sm:h-9" strokeWidth={2.5} />
              </motion.button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
