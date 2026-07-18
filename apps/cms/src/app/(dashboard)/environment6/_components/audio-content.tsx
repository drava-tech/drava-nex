import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Speaker as SpeakerIcon, Plug, VolumeX } from "lucide-react";
import { Badge } from "@platform/ui";
import { MiniSlider, Switch } from "./controls";
import { noProp } from "./utils";

export default function AudioContent({ isExpanded, state, actions }: any) {
  const inputOptions = ["HDMI", "AUX", "Bluetooth"] as const;
  const currentInput = state.input ?? inputOptions[0];
  const [showInputOptions, setShowInputOptions] = useState(false);
  const [liveWaveform, setLiveWaveform] = useState(() => Array.from({ length: 48 }, () => 0));
  const [isDragging, setIsDragging] = useState(false);
  const barsRef = useRef(new Float32Array(48));
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let frameId = 0;
    let last = performance.now();
    const start = last;

    // Deterministic value noise: band-limited randomness, so bars move
    // organically without the per-frame flicker Math.random() would cause.
    const hash = (n: number) => {
      const s = Math.sin(n) * 43758.5453123;
      return s - Math.floor(s);
    };
    const noise = (x: number) => {
      const ix = Math.floor(x);
      const f = x - ix;
      const u = f * f * (3 - 2 * f);
      return hash(ix) * (1 - u) + hash(ix + 1) * u;
    };

    const BPM = 122;

    const tick = (now: number) => {
      const { power, muted, volume, bass } = stateRef.current;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const elapsed = (now - start) / 1000;

      const level = power && !muted ? Math.pow(Math.max(0.08, volume / 100), 0.75) : 0;
      const bassAmt = 1 + (bass / 10) * 0.7;

      // Beat clock: kick on the beat (varying strength), snare/hats on the off-beat.
      const beats = (elapsed * BPM) / 60;
      const beatIdx = Math.floor(beats);
      const kick = Math.exp(-(beats - beatIdx) * 6) * (0.65 + 0.35 * hash(beatIdx * 7.13));
      const off = beats + 0.5;
      const snare = Math.exp(-(off - Math.floor(off)) * 9) * (0.4 + 0.3 * hash(Math.floor(off) * 3.7));

      // Slow drift so the whole track "breathes" (builds and drops) over ~5-10s.
      const energy = 0.6 + 0.4 * noise(elapsed * 0.22);

      const bars = barsRef.current;
      const next = new Array<number>(48);

      for (let i = 0; i < 48; i++) {
        let target = 0;
        if (level) {
          const pos = i / 47;
          const edge = Math.abs(pos - 0.5) * 2; // 0 at centre, 1 at edges
          const dome = 0.65 + Math.sin(pos * Math.PI) * 0.35;

          // Three noise octaves: slow body, musical mids, hf shimmer toward the edges.
          const body = noise(elapsed * 1.4 + i * 0.13) * 0.55;
          const mids = noise(elapsed * 5.5 + i * 0.41 + 50) * 0.3;
          const hf = noise(elapsed * 12 + i * 1.3 + 200) * 0.25 * (0.4 + edge * 0.6);

          // Kick pumps the low bands in the centre; snare energy excites the edges.
          const kickHit = kick * (1 - edge * 0.75) * 0.5 * bassAmt;
          const snareHit = snare * (0.25 + edge * 0.4) * 0.35;

          target = (body + mids + hf + kickHit + snareHit) * energy * dome * level * 100;
          target = Math.max(2, Math.min(100, target));
        }

        // Meter ballistics: fast attack, slow release — the asymmetry is what
        // makes the bars read as reacting to real audio.
        const prev = bars[i] ?? 0;
        const rate = target > prev ? 30 : 8;
        const value = prev + (target - prev) * (1 - Math.exp(-rate * dt));
        bars[i] = value;
        next[i] = value;
      }

      setLiveWaveform(next);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const lastPctRef = useRef<number | null>(null);

  const updateVol = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.round((Math.max(0, Math.min(e.clientX - rect.left, rect.width)) / rect.width) * 100);
    if (pct === lastPctRef.current) return; // skip redundant updates on sub-pixel jitter
    lastPctRef.current = pct;
    actions.setVolume(pct);
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
          <Badge variant={state.power ? "default" : "secondary"} className={`${isExpanded ? "" : "hidden xl:inline-flex"} bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest`}>{state.power ? "Playing" : "Off"}</Badge>
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
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${state.power && !state.muted ? state.volume : 0}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0 w-full flex-col gap-4 lg:gap-6 py-1" onClick={noProp}>
            <div className="grid grid-cols-1 xl:grid-cols-[112px_112px_minmax(0,1fr)] gap-2 lg:gap-3 items-stretch shrink-0">
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

              <div className="rounded-xl border border-border bg-muted/20 px-3 py-2 lg:px-4 lg:py-3">
                <MiniSlider
                  label="Bass Control"
                  value={state.bass}
                  onChange={actions.setBass}
                  min={-10}
                  max={10}
                  suffix=""
                  color="bg-blue-500"
                />
              </div>
            </div>

            <div className="min-w-0 lg:flex lg:flex-1 lg:min-h-0 lg:flex-col">
              <div className="flex items-start justify-between mb-2 lg:mb-4 shrink-0">
                <span className="text-3xl lg:text-5xl font-black">{state.muted ? 0 : state.volume}<span className="text-lg lg:text-2xl text-blue-500/50">%</span></span>
                <span className="text-[10px] lg:text-xs font-bold text-muted-foreground uppercase tracking-widest">Master Volume</span>
              </div>
              <div
                className="w-full h-20 relative cursor-ew-resize touch-none flex items-end justify-between gap-[2px] lg:h-auto lg:flex-1 lg:min-h-0 lg:max-h-40"
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setIsDragging(true); updateVol(e); }}
                onPointerMove={(e) => { if (isDragging) updateVol(e); }}
                onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setIsDragging(false); }}
                onPointerCancel={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setIsDragging(false); }}
              >
                {liveWaveform.map((h, i) => {
                  const vol = state.muted ? 0 : state.volume;
                  const isActive = state.power && !state.muted && (i / liveWaveform.length) * 100 <= vol;
                  return (
                    <div key={i} className={`flex-1 rounded-full transition duration-150 ${isActive ? 'bg-gradient-to-t from-blue-600 to-cyan-400 shadow-[0_0_8px_rgba(56,189,248,0.4)]' : 'bg-muted'}`}
                      style={{ height: `${h}%`, opacity: isActive ? 1 : 0.5 }} />
                  );
                })}
              </div>
              <p className="text-center text-[9px] lg:text-[10px] font-bold text-blue-500 tracking-widest uppercase opacity-60 mt-2 lg:mt-3 shrink-0">Slide to adjust</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
