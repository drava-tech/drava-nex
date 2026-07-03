"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Thermometer, Wind, Flame,
  Lightbulb, Sparkles, Copy, X,
  Speaker as SpeakerIcon, Settings2, Moon, Sun, Zap, Clock, RotateCw, Plug, VolumeX, Mic
} from "lucide-react";
import { Button, Badge } from "@platform/ui";
import { EnvironmentView as ThreeDView } from "../../environment5/_components/environment-view";

type PanelType = "climate" | "lighting" | "audio";

const flowTransitionProps = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -16, transition: { duration: 0.28, ease: [0.4, 0, 1, 1] } },
} as any;

const cardLayoutTransition = { type: "spring", bounce: 0.14, duration: 0.9 } as any;

const noProp = (e: React.SyntheticEvent) => e.stopPropagation();

const getTempColor = (temp: number) => {
  if (temp < 20) return "from-cyan-400 to-blue-600";
  if (temp < 24) return "from-emerald-400 to-teal-600";
  if (temp < 27) return "from-orange-400 to-amber-600";
  return "from-rose-500 to-red-600";
};

const getSceneGlow = (scene: string) => {
  switch (scene) {
    case "Presentation": return "from-violet-500 to-fuchsia-500 shadow-[0_0_30px_rgba(167,139,250,0.8)]";
    case "Ambient":      return "from-indigo-600 to-purple-800 shadow-[0_0_30px_rgba(79,70,229,0.8)]";
    case "Focus":        return "from-blue-400 to-cyan-500 shadow-[0_0_30px_rgba(56,189,248,0.8)]";
    case "Relax":        return "from-emerald-400 to-teal-500 shadow-[0_0_30px_rgba(52,211,153,0.8)]";
    default:             return "from-zinc-400 to-zinc-600 shadow-[0_0_30px_rgba(161,161,170,0.8)]";
  }
};

// ─── UTILS ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1]!, 16), g: parseInt(result[2]!, 16), b: parseInt(result[3]!, 16) } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number) {
  return "#" + (1 << 24 | Math.round(r) << 16 | Math.round(g) << 8 | Math.round(b)).toString(16).slice(1).toUpperCase();
}

function hsvToRgb(h: number, s: number, v: number) {
  let f = (n: number, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) };
}

function rgbToHsv(r: number, g: number, b: number) {
  let v = Math.max(r, g, b), c = v - Math.min(r, g, b);
  let h = c && ((v == r) ? (g - b) / c : ((v == g) ? 2 + (b - r) / c : 4 + (r - g) / c));
  return { h: 60 * (h < 0 ? h + 6 : h), s: v && c / v, v: v / 255 };
}

// ─── SLIDER & TOGGLE ──────────────────────────────────────────────────────────

function MiniSlider({ value, onChange, min = 0, max = 100, label, suffix = "%", color = "bg-zinc-900 dark:bg-white" }: { value: number, onChange: (v: number) => void, min?: number, max?: number, label?: string, suffix?: string, color?: string }) {
  const [dragging, setDragging] = useState(false);

  const pctFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return Math.round(min + (x / rect.width) * (max - min));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(pctFromEvent(e));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (dragging) onChange(pctFromEvent(e));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };

  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between items-center mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
          <span className="text-[11px] font-black text-foreground">{value}{suffix}</span>
        </div>
      )}
      <div
        className="w-full h-3 bg-zinc-200 dark:bg-zinc-800 rounded-full relative cursor-pointer touch-none flex items-center shadow-inner"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className={`absolute left-0 h-full rounded-full ${color}`} style={{ width: `${pct}%`, transition: dragging ? 'none' : 'width 0.15s' }} />
        <motion.div
          className="absolute h-5 w-5 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.15)] rounded-full border border-zinc-200"
          animate={{ left: `calc(${pct}% - 10px)` }}
          transition={{ type: "spring", bounce: 0, duration: dragging ? 0 : 0.2 }}
        />
      </div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean, onChange: (c: boolean) => void }) {
  return (
    <div
      className={`w-11 h-6 rounded-full p-1 cursor-pointer transition-colors ${checked ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-200 dark:bg-zinc-700'}`}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
    >
      <motion.div
        className={`w-4 h-4 rounded-full bg-white dark:bg-zinc-900 shadow-sm`}
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      />
    </div>
  );
}

// ─── RENDERERS ────────────────────────────────────────────────────────────────

function ClimateControlIcon({ type, active }: { type: "swing" | "timer" | "turbo" | "fan", active?: boolean }) {
  if (type === "swing") {
    return (
      <span className="relative flex h-5 w-7 items-center justify-center">
        <motion.span
          className="absolute left-0 top-0.5"
          animate={active ? { rotate: 360 } : { rotate: 0 }}
          transition={active ? { duration: 2.2, repeat: Infinity, ease: "linear" } : { duration: 0.2 }}
        >
          <RotateCw className="h-4 w-4" />
        </motion.span>
        <motion.span
          className="absolute right-0 top-1"
          animate={active ? { x: [-2, 2, -2], opacity: [0.55, 1, 0.55] } : { x: 0, opacity: 0.85 }}
          transition={active ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        >
          <Wind className="h-4 w-4" />
        </motion.span>
      </span>
    );
  }

  if (type === "timer") {
    return (
      <motion.span
        animate={active ? { rotate: [0, 8, 0, -8, 0] } : { rotate: 0 }}
        transition={active ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
      >
        <Clock className="w-4 h-4" />
      </motion.span>
    );
  }

  if (type === "turbo") {
    return (
      <motion.span
        animate={active ? { scale: [1, 1.22, 1], opacity: [0.8, 1, 0.8] } : { scale: 1, opacity: 1 }}
        transition={active ? { duration: 0.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
      >
        <Zap className="w-4 h-4" />
      </motion.span>
    );
  }

  return (
    <motion.span
      animate={active ? { x: [-2, 2, -2] } : { x: 0 }}
      transition={active ? { duration: 1, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
    >
      <Wind className="w-4 h-4" />
    </motion.span>
  );
}

function ClimateContent({ isExpanded, state, actions }: any) {
  const [showTimerOptions, setShowTimerOptions] = useState(false);
  const [showFanOptions, setShowFanOptions] = useState(false);

  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className="flex justify-between items-start shrink-0 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Thermometer className="w-4 h-4" />
          </div>
          <h3 className="font-semibold tracking-tight text-lg">Climate</h3>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={state.power ? "default" : "secondary"} className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest">{state.power ? "● Online" : "Off"}</Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      <div className={`flex-1 min-h-0 flex flex-col justify-center transition-all duration-150 ${!state.power ? 'opacity-40 grayscale-[0.8] pointer-events-none' : ''}`}>
        {!isExpanded ? (
          <div className="flex flex-col pb-2">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black">{state.temp}°</span>
              <span className="text-muted-foreground text-sm font-bold uppercase tracking-wider">{state.mode}</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 w-full overflow-visible grid grid-cols-1 lg:grid-cols-[minmax(210px,0.82fr)_minmax(0,1.18fr)] items-center gap-4 lg:gap-5 py-1">
            <div className="flex min-h-0 items-center justify-center lg:justify-start lg:pl-4">
              <div className="relative w-40 h-40 md:w-52 md:h-52 flex items-center justify-center shrink-0">
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
              <div className="relative w-32 h-32 md:w-40 md:h-40 rounded-full bg-card shadow-2xl flex flex-col items-center justify-center z-10 border border-border">
                <div className={`absolute inset-3 rounded-full blur-xl opacity-20 transition-colors duration-1000 ${state.temp > 24 ? 'bg-orange-500' : 'bg-cyan-500'} animate-pulse`} />
                <span className={`text-5xl md:text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b ${getTempColor(state.temp)} relative z-10`}>
                  {state.temp}°
                </span>
                <span className="text-[9px] font-black text-muted-foreground tracking-widest uppercase mt-0.5 relative z-10">Target</span>
              </div>
              </div>
            </div>

            <div className="relative z-20 flex min-h-0 w-full max-w-[420px] justify-self-end flex-col justify-center gap-3 pr-1">
              <div className="flex justify-end gap-2 shrink-0">
                <Button variant="outline" size="icon" className="w-10 h-10 rounded-full" onClick={(e) => { noProp(e); actions.setTemp(Math.max(16, state.temp - 1)); }}>
                  <Wind className="w-5 h-5" />
                </Button>
                <Button variant="outline" size="icon" className="w-10 h-10 rounded-full" onClick={(e) => { noProp(e); actions.setTemp(Math.min(30, state.temp + 1)); }}>
                  <Flame className="w-5 h-5" />
                </Button>
              </div>

              <div className="relative w-full shrink-0">
                <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={(e) => { noProp(e); actions.setSwing(!state.swing); }}
                  className={`h-16 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all duration-300 ${
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
                  className={`h-16 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all duration-300 ${
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
                  className={`h-16 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all duration-300 ${
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
                  className={`h-16 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all duration-300 ${
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

function LightingContent({ isExpanded, state, actions }: any) {
  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className="flex justify-between items-start shrink-0 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Lightbulb className="w-4 h-4" />
          </div>
          <h3 className="font-semibold tracking-tight text-lg flex items-center gap-2">
            Lighting
            {isExpanded && (
              <button className="w-[13px] h-[13px] rounded-full hover:scale-125 transition-transform cursor-pointer shadow-[0_0_8px_rgba(0,0,0,0.5)] border border-black/10 dark:border-white/20" style={{ backgroundColor: state.color.hex }} onClick={(e) => { e.stopPropagation(); actions.toggleColourPanel?.(); }} />
            )}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={state.power ? "default" : "secondary"} className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest">{state.power ? "● Online" : "Off"}</Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      <div className={`flex-1 flex flex-col justify-start transition-all duration-150 ${!state.power ? 'opacity-40 grayscale-[0.8] pointer-events-none' : ''}`}>
        {!isExpanded ? (
          <div className="flex flex-col pb-2">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black">{state.brightness}%</span>
              <span className="text-muted-foreground text-sm font-bold uppercase tracking-wider">Brightness</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 pt-0 min-h-0">
            {/* Left Column: Master & Zones */}
            <div className="flex flex-col gap-4">
               <div className="space-y-3">
                 <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1 block">Brightness Control</span>
                 <MiniSlider label="Master Brightness" value={state.brightness} onChange={actions.setBrightness} max={100} suffix="%" />
                 
                 <div className="space-y-2.5 pt-1">
                    {Object.entries(state.zones).map(([zone, val]) => {
                       const storedVal = val as number;
                       const outputVal = state.power ? Math.round((storedVal * state.brightness) / 100) : 0;
                       return (
                         <div key={zone}>
                            <div className="flex justify-between items-center mb-1.5">
                               <div className="flex items-center gap-2">
                                 <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest flex items-center gap-1.5">
                                   {zone}
                                   <button className="w-[8px] h-[8px] md:w-[10px] md:h-[10px] rounded-full hover:scale-125 transition-transform cursor-pointer shadow-[0_0_8px_rgba(0,0,0,0.5)] border border-black/10 dark:border-white/20" style={{ backgroundColor: state.color.hex }} onClick={(e) => { e.stopPropagation(); actions.toggleColourPanel?.(); }} />
                                 </span>
                                 <span className="text-[8px] md:text-[9px] uppercase font-bold text-muted-foreground bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded">{outputVal}% Out</span>
                               </div>
                               <span className="text-[10px] md:text-xs font-black text-foreground">{storedVal}%</span>
                            </div>
                            <MiniSlider label="" value={storedVal} onChange={(v) => actions.setZoneBrightness(zone, v)} max={100} suffix="" />
                         </div>
                       );
                    })}
                 </div>
               </div>
            </div>
            
            {/* Right Column: Scenes & Devices */}
            <div className="space-y-4 md:space-y-6">
               <div>
                 <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2 block">Environment Scenes</span>
                 <div className="grid grid-cols-2 gap-2 md:gap-3">
                   {[
                     { name: "Presentation", icon: <Sparkles className="w-5 h-5" /> },
                     { name: "Ambient",      icon: <Moon className="w-5 h-5" /> },
                     { name: "Focus",        icon: <Zap className="w-5 h-5" /> },
                     { name: "Relax",        icon: <Sun className="w-5 h-5" /> },
                   ].map(s => {
                     const isActive = state.activeScene === s.name;
                     return (
                       <div
                         key={s.name}
                         onClick={() => actions.setActiveScene(s.name)}
                         className={`group/btn relative flex flex-col items-center justify-center p-3 rounded-[20px] cursor-pointer transition-all duration-500 overflow-hidden border ${isActive
                           ? "bg-zinc-900 dark:bg-white border-transparent scale-[1.03]"
                           : "bg-white/50 dark:bg-card/50 border-border hover:bg-card dark:hover:bg-card hover:scale-[1.02]"
                         }`}
                       >
                         {isActive && (
                           <div className={`absolute inset-0 opacity-20 dark:opacity-30 bg-gradient-to-br ${getSceneGlow(s.name)} animate-pulse`} />
                         )}
                         <div className={`mb-2 transition-transform duration-500 ${isActive ? 'scale-110' : 'group-hover/btn:scale-110'}`}>
                           <div className={`p-3 rounded-full ${isActive ? 'text-white dark:text-zinc-900' : 'text-muted-foreground'}`}>
                             {isActive ? (
                               <div className="relative">
                                 {s.icon}
                                 <div className={`absolute inset-0 blur-lg bg-gradient-to-tr ${getSceneGlow(s.name)} -z-10`} />
                               </div>
                             ) : s.icon}
                           </div>
                         </div>
                         <span className={`text-[10px] font-black tracking-widest uppercase transition-colors ${isActive ? "text-white dark:text-zinc-900" : "text-muted-foreground"}`}>
                           {s.name}
                         </span>
                       </div>
                     );
                   })}
                 </div>
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LightColourContent({ state, actions }: any) {
  const [hexInput, setHexInput] = useState(state.color.hex);
  const [mode, setMode] = useState<"RGBW" | "RGB">("RGBW");
  const [isValidHex, setIsValidHex] = useState(true);

  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHexInput(state.color.hex);
    setIsValidHex(true);
  }, [state.color.hex]);

  const handleHexChange = (val: string) => {
    setHexInput(val);
    setIsValidHex(/^#[0-9A-F]{6}$/i.test(val));
  };

  const handleHexApply = () => {
    if (isValidHex) {
      const { r, g, b } = hexToRgb(hexInput);
      actions.setColor({ ...state.color, r, g, b, hex: hexInput.toUpperCase() });
      if (actions.closeColourPanel) actions.closeColourPanel();
    }
  };

  const handleRgbChange = (channel: 'r' | 'g' | 'b' | 'w', val: number) => {
    const newColor = { ...state.color, [channel]: val };
    if (channel !== 'w') newColor.hex = rgbToHex(newColor.r, newColor.g, newColor.b);
    actions.setColor(newColor);
  };

  // Spectrum drag logic
  const handlePickerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pickerRef.current) return;
    const rect = pickerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const h = (x / rect.width) * 360;
    const s = 1; // Full saturation horizontally in this UI
    const v = 1 - (y / rect.height);

    const { r, g, b } = hsvToRgb(h, s, v);
    actions.setColor({ ...state.color, r, g, b, hex: rgbToHex(r, g, b) });
  };

  const handleBrightnessChange = (pct: number) => {
    const currentMax = Math.max(state.color.r, state.color.g, state.color.b, state.color.w);
    if (currentMax === 0) {
      if (mode === "RGBW") {
        actions.setColor({ ...state.color, w: Math.round((pct / 100) * 255) });
      } else {
        const val = Math.round((pct / 100) * 255);
        actions.setColor({ ...state.color, r: val, g: val, b: val, hex: rgbToHex(val, val, val) });
      }
      return;
    }
    const scale = ((pct / 100) * 255) / currentMax;
    const r = Math.min(255, Math.round(state.color.r * scale));
    const g = Math.min(255, Math.round(state.color.g * scale));
    const b = Math.min(255, Math.round(state.color.b * scale));
    const w = Math.min(255, Math.round(state.color.w * scale));
    actions.setColor({ ...state.color, r, g, b, w, hex: rgbToHex(r, g, b) });
  };

  // Derive handle position and brightness
  const hsv = rgbToHsv(state.color.r, state.color.g, state.color.b);
  const handleX = (hsv.h / 360) * 100;
  const handleY = (1 - hsv.v) * 100;
  const currentBrightness = Math.round((Math.max(state.color.r, state.color.g, state.color.b, state.color.w) / 255) * 100);

  return (
    <div className="flex flex-col z-10 relative text-card-foreground" onClick={noProp}>
      <div className="flex items-center gap-2 mb-8">
        <Settings2 className="w-5 h-5" />
        <h3 className="font-semibold tracking-tight text-lg uppercase">Light Colour</h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

        {/* Left Column (~45%) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="flex bg-zinc-100 dark:bg-zinc-900/50 p-1 rounded-xl w-fit relative">
            <div
              className="absolute top-1 bottom-1 w-20 rounded-lg bg-white dark:bg-zinc-800 shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ transform: mode === "RGBW" ? 'translateX(0)' : 'translateX(5rem)' }}
            />
            <button className={`relative z-10 h-8 w-20 text-xs font-bold transition-colors ${mode === "RGBW" ? 'text-foreground' : 'text-muted-foreground'}`} onClick={() => setMode("RGBW")}>RGBW</button>
            <button className={`relative z-10 h-8 w-20 text-xs font-bold transition-colors ${mode === "RGB" ? 'text-foreground' : 'text-muted-foreground'}`} onClick={() => {
              setMode("RGB");
              handleRgbChange('w', 0); // Clear white channel when switching to RGB
            }}>RGB</button>
          </div>

          <div
            ref={pickerRef}
            className="w-full h-48 lg:h-56 rounded-2xl relative cursor-crosshair touch-none shadow-inner overflow-hidden"
            style={{
              background: `linear-gradient(to bottom, transparent, black), linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)`
            }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePickerDrag(e); }}
            onPointerMove={(e) => { if (e.buttons > 0) handlePickerDrag(e); }}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
          >
            <motion.div
              className="absolute w-5 h-5 rounded-full border-[2.5px] border-white shadow-[0_0_8px_rgba(0,0,0,0.6)] -ml-2.5 -mt-2.5 pointer-events-none"
              animate={{ left: `${handleX}%`, top: `${handleY}%` }}
              transition={{ type: "spring", bounce: 0, duration: 0.2 }}
            />
          </div>

          <div className="pt-2">
            <MiniSlider label="Brightness" min={0} max={100} suffix="%" color="bg-zinc-900 dark:bg-white" value={currentBrightness} onChange={handleBrightnessChange} />
          </div>
        </div>

        {/* Center Column (~25%) */}
        <div className="lg:col-span-3 flex flex-col gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block">Preview</span>
          <motion.div
            className="w-full aspect-square md:aspect-[4/3] lg:aspect-[4/5] rounded-[24px] shadow-inner"
            animate={{ backgroundColor: state.color.hex, opacity: Math.max(0.2, currentBrightness / 100) }}
            transition={{ type: "spring", bounce: 0, duration: 0.3 }}
          />
        </div>

        {/* Right Column (~30%) */}
        <div className="lg:col-span-4 flex flex-col gap-8">

          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-3">Hex Code</span>
            <div className="flex items-center justify-between border border-border rounded-2xl px-5 py-4 bg-muted/30">
              <span className="font-mono font-black">{state.color.hex}</span>
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg hover:bg-muted"><Copy className="w-4 h-4 text-muted-foreground" /></Button>
            </div>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-3">Edit Hex Code</span>
            <div className="flex gap-3 items-start">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={hexInput}
                  onChange={(e) => handleHexChange(e.target.value)}
                  className={`w-full bg-transparent border ${isValidHex ? 'border-border focus:border-primary' : 'border-red-500 focus:border-red-500'} rounded-2xl px-5 text-sm font-mono focus:outline-none h-14 shadow-sm transition-colors`}
                />
                {!isValidHex && <span className="absolute -bottom-5 left-2 text-[10px] text-red-500 font-medium">Invalid HEX format</span>}
              </div>
              <Button
                size="sm"
                className="h-14 px-8 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
                onClick={handleHexApply}
                disabled={!isValidHex}
              >
                Apply
              </Button>
            </div>
          </div>

          <div className="pt-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-3">RGBW Values</span>
            <div className="flex items-center gap-1.5">
              {['r', 'g', 'b', 'w'].map(c => {
                if (mode === "RGB" && c === 'w') return null;
                return (
                  <div key={c} className="flex-1 flex flex-col items-center gap-1.5">
                    <span className="text-[9px] font-bold uppercase text-muted-foreground">{c}</span>
                    <input
                      type="number" min="0" max="255" step="any"
                      value={state.color[c as 'r' | 'g' | 'b' | 'w']}
                      onChange={(e) => handleRgbChange(c as 'r' | 'g' | 'b' | 'w', parseFloat(e.target.value) || 0)}
                      className="w-full px-0.5 bg-muted/50 border border-transparent focus:border-primary focus:bg-background rounded-xl h-12 text-center text-xs font-black focus:outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                );
              })}
              <div className="flex items-end pb-2 pl-1 shrink-0"><span className="text-muted-foreground font-black text-xs">%</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AudioContent({ isExpanded, state, actions }: any) {
  const inputOptions = ["HDMI", "AUX", "Bluetooth"] as const;
  const currentInput = state.input ?? inputOptions[0];
  const [showInputOptions, setShowInputOptions] = useState(false);
  const [analyzerStatus, setAnalyzerStatus] = useState<"idle" | "listening" | "blocked">("idle");
  const [liveWaveform, setLiveWaveform] = useState(() => Array.from({ length: 48 }, () => 10));
  const [isDragging, setIsDragging] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  const stopDeviceAnalyzer = () => {
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    analyzerRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close();
    audioContextRef.current = null;
    setAnalyzerStatus("idle");
  };

  const startDeviceAnalyzer = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setAnalyzerStatus("blocked");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const audioContext = new AudioContext();
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 128;
      analyzer.smoothingTimeConstant = 0.72;
      audioContext.createMediaStreamSource(stream).connect(analyzer);

      audioStreamRef.current = stream;
      audioContextRef.current = audioContext;
      analyzerRef.current = analyzer;
      setAnalyzerStatus("listening");
    } catch {
      setAnalyzerStatus("blocked");
    }
  };

  useEffect(() => {
    return () => {
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioContextRef.current) void audioContextRef.current.close();
    };
  }, []);

  useEffect(() => {
    let frameId = 0;
    const start = performance.now();
    const frequencyData = new Uint8Array(64);

    const tick = (now: number) => {
      const analyzer = analyzerRef.current;

      if (analyzer && analyzerStatus === "listening" && state.power && !state.muted) {
        analyzer.getByteFrequencyData(frequencyData);
        const volumeScale = Math.max(0.15, state.volume / 100);
        setLiveWaveform(Array.from({ length: 48 }, (_, i) => {
          const bin = Math.min(frequencyData.length - 1, Math.floor((i / 48) * frequencyData.length));
          const nextBin = Math.min(frequencyData.length - 1, bin + 1);
          const raw = ((frequencyData[bin] ?? 0) * 0.72 + (frequencyData[nextBin] ?? 0) * 0.28) / 255;
          const bassBoost = i < 12 ? 1 + state.bass / 20 : 1;
          return Math.max(8, Math.min(100, raw * 120 * volumeScale * bassBoost));
        }));
      } else {
        const elapsed = (now - start) / 1000;
        const level = state.power && state.playing && !state.muted ? Math.max(0.12, state.volume / 100) : 0;

        setLiveWaveform(Array.from({ length: 48 }, (_, i) => {
          if (!level) return 8;
          const bassBoost = 1 + state.bass / 24;
          const low = Math.sin(elapsed * 4.8 + i * 0.34) * 18 * bassBoost;
          const mid = Math.sin(elapsed * 8.5 + i * 0.72) * 10;
          const high = Math.sin(elapsed * 14 + i * 1.1) * 5;
          const envelope = Math.sin(i / 47 * Math.PI) * 18;
          return Math.max(8, Math.min(100, (28 + envelope + low + mid + high) * level));
        }));
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [analyzerStatus, state.bass, state.muted, state.playing, state.power, state.volume]);
  const updateVol = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    actions.setVolume(Math.round((Math.max(0, Math.min(e.clientX - rect.left, rect.width)) / rect.width) * 100));
    actions.setMuted(false);
  };

  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className="flex justify-between items-start shrink-0 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
            <SpeakerIcon className="w-4 h-4" />
          </div>
          <h3 className="font-semibold tracking-tight text-lg">Audio</h3>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={state.power ? "default" : "secondary"} className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest">{state.power ? "● Playing" : "Off"}</Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      <div className={`flex-1 flex flex-col justify-center transition-all duration-150 ${!state.power ? 'opacity-40 grayscale-[0.8] pointer-events-none' : ''}`}>
        {!isExpanded ? (
          <div className="flex flex-col pb-2">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black">{state.muted ? "Mute" : `${state.volume}%`}</span>
              <span className="text-muted-foreground text-sm font-bold uppercase tracking-wider">Volume</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0 w-full flex-col justify-between gap-4 py-1" onClick={noProp}>
            <div className="grid grid-cols-1 xl:grid-cols-[112px_112px_112px_minmax(0,1fr)] gap-2 items-stretch">
              <div className="relative z-30">
                <button
                  onClick={(e) => { noProp(e); setShowInputOptions((open) => !open); }}
                  className="h-12 w-full rounded-xl border border-blue-500/30 bg-blue-500/10 px-2 py-2 flex flex-col items-center justify-center gap-1 text-blue-500 font-bold transition-all hover:bg-blue-500/15 shadow-[0_0_14px_rgba(59,130,246,0.18)]"
                >
                  <Plug className="w-4 h-4" />
                  <span className="text-[8px] uppercase tracking-widest">Input {currentInput}</span>
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
                className={`h-12 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all ${
                  state.muted
                    ? 'bg-red-500/10 text-red-500 border-red-500/40 shadow-[0_0_14px_rgba(239,68,68,0.25)]'
                    : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/50'
                }`}
              >
                <VolumeX className="w-4 h-4" />
                <span className="text-[8px] uppercase tracking-widest">{state.muted ? "Muted" : "Mute"}</span>
              </button>

              <button
                onClick={(e) => { noProp(e); analyzerStatus === "listening" ? stopDeviceAnalyzer() : void startDeviceAnalyzer(); }}
                className={`h-12 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all ${analyzerStatus === "listening" ? 'bg-blue-500/10 text-blue-500 border-blue-500/40 shadow-[0_0_14px_rgba(59,130,246,0.25)]' : analyzerStatus === "blocked" ? 'bg-red-500/10 text-red-500 border-red-500/40' : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/50'}`}
              >
                <Mic className="w-4 h-4" />
                <span className="text-[8px] uppercase tracking-widest">{analyzerStatus === "listening" ? "Live" : analyzerStatus === "blocked" ? "Blocked" : "Device"}</span>
              </button>

              <div className="rounded-xl border border-border bg-muted/20 px-3 py-2">
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

            <div className="min-w-0">
              <div className="flex items-start justify-between mb-2">
                <span className="text-3xl font-black">{state.muted ? 0 : state.volume}<span className="text-lg text-blue-500/50">%</span></span>
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Master Volume</span>
              </div>
              <div
                className="w-full h-20 relative cursor-ew-resize touch-none flex items-end justify-between gap-[2px]"
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setIsDragging(true); updateVol(e); }}
                onPointerMove={(e) => { if (isDragging) updateVol(e); }}
                onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setIsDragging(false); }}
                onPointerCancel={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setIsDragging(false); }}
              >
                {liveWaveform.map((h, i) => {
                  const vol = state.muted ? 0 : state.volume;
                  const isActive = state.power && !state.muted && (i / liveWaveform.length) * 100 <= vol;
                  return (
                    <div key={i} className={`flex-1 rounded-full transition-all duration-150 ${isActive ? 'bg-gradient-to-t from-blue-600 to-cyan-400 shadow-[0_0_8px_rgba(56,189,248,0.4)]' : 'bg-muted'}`}
                      style={{ height: `${h}%`, opacity: isActive ? 1 : 0.5 }} />
                  );
                })}
              </div>
              <p className="text-center text-[9px] font-bold text-blue-500 tracking-widest uppercase opacity-60 mt-2">Slide to adjust</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export function EnvironmentView() {
  const [focused, setFocused] = useState<PanelType>("climate");
  const [isClient, setIsClient] = useState(false);
  const [showColourPanel, setShowColourPanel] = useState(false);
  const [show3D, setShow3D] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // States
  const [climate, setClimate] = useState({
    power: true,
    temp: 22,
    mode: "Dry",
    fan: 60,
    swing: false,
    turbo: false,
    timer: null as string | null,
    fanSpeed: "Med",
  });
  const [lighting, setLighting] = useState({
    power: true,
    brightness: 49,
    activeScene: "Presentation",
    zones: { "Roof Lights": 64, "Wall Lights 1": 70, "Wall Lights 2": 74 },
    color: { r: 138, g: 92, b: 255, w: 100, hex: "#8A5CFF" }
  });
  const [audio, setAudio] = useState({ power: true, playing: true, volume: 45, muted: false, input: "HDMI", bass: 0, treble: 0 });

  // Global Quick Devices State
  const [globalPower, setGlobalPower] = useState({ ac: true, lights: true, audio: true });

  // Persistence
  useEffect(() => {
    setIsClient(true);
    const saved = localStorage.getItem("cms_environment6_panel") as PanelType;
    if (saved && ["climate", "lighting", "audio"].includes(saved)) {
      setFocused(saved);
    }
  }, []);

  useEffect(() => {
    if (isClient && focused) localStorage.setItem("cms_environment6_panel", focused);
  }, [focused, isClient]);

  // Order
  const orderedContents = [focused, ...(["climate", "lighting", "audio"] as PanelType[]).filter(x => x !== focused)];

  const renderContent = (type: PanelType, isExpanded: boolean) => {
    if (type === "climate") return <ClimateContent key="climate" isExpanded={isExpanded} state={climate} actions={{
      setTemp: (temp: number) => setClimate(s => ({ ...s, temp })),
      setMode: (mode: string) => setClimate(s => ({ ...s, mode })),
      setFan: (fan: number) => setClimate(s => ({ ...s, fan })),
      setPower: (power: boolean) => setClimate(s => ({ ...s, power })),
      setSwing: (swing: boolean) => setClimate(s => ({ ...s, swing })),
      setTurbo: (turbo: boolean) => setClimate(s => ({ ...s, turbo })),
      setTimer: (timer: string | null) => setClimate(s => ({ ...s, timer })),
      setFanSpeed: (fanSpeed: string) => setClimate(s => ({ ...s, fanSpeed })),
    }} />;
    if (type === "lighting") return <LightingContent key="lighting" isExpanded={isExpanded} state={lighting} globalPowerState={globalPower} globalPowerActions={{
      setAc: (ac: boolean) => setGlobalPower(s => ({ ...s, ac })),
      setLights: (lights: boolean) => setGlobalPower(s => ({ ...s, lights })),
      setAudio: (audio: boolean) => setGlobalPower(s => ({ ...s, audio })),
    }} actions={{
      setBrightness: (brightness: number) => setLighting(s => ({ ...s, brightness })),
      setZoneBrightness: (zone: string, brightness: number) => setLighting(s => ({ ...s, zones: { ...s.zones, [zone]: brightness } })),
      setActiveScene: (activeScene: string) => setLighting(s => ({ ...s, activeScene })),
      setColor: (color: any) => setLighting(s => ({ ...s, color })),
      setPower: (power: boolean) => setLighting(s => ({ ...s, power })),
      toggleColourPanel: () => { setFocused("lighting"); setShowColourPanel(s => !s); },
    }} />;
    if (type === "audio") return <AudioContent key="audio" isExpanded={isExpanded} state={audio} globalPowerState={globalPower} actions={{
      setPlaying: (playing: boolean) => setAudio(s => ({ ...s, playing })),
      setVolume: (volume: number) => setAudio(s => ({ ...s, volume })),
      setMuted: (muted: boolean) => setAudio(s => ({ ...s, muted })),
      setInput: (input: string) => setAudio(s => ({ ...s, input })),
      setPower: (power: boolean) => setAudio(s => ({ ...s, power })),
      setBass: (bass: number) => setAudio(s => ({ ...s, bass })),
      setTreble: (treble: number) => setAudio(s => ({ ...s, treble })),
    }} />;
    return null;
  };

  if (!isClient) return null;

  return (
    <div className="w-full h-full flex flex-col gap-6 overflow-hidden font-sans text-foreground pb-2">
       
       <div className="flex justify-between items-center shrink-0 pt-2 pb-0">
          <div>
            <h1 className="text-3xl font-black tracking-tight mb-1">Environment Control</h1>
            <p className="text-muted-foreground font-medium">Manage workspace climate, lighting, audio, and devices.</p>
          </div>
          <Button variant="outline" className="rounded-xl font-bold tracking-widest text-xs uppercase" onClick={() => setShow3D(true)}>
            3D
          </Button>
       </div>

       <div
         className="flex-1 w-full grid gap-6 min-h-0"
         style={isDesktop
           ? { gridTemplateColumns: "68fr 32fr", gridTemplateRows: "1fr 1fr", gridTemplateAreas: '"primary top" "primary bottom"' }
           : { gridTemplateColumns: "1fr", gridTemplateRows: "auto auto auto", gridTemplateAreas: '"primary" "top" "bottom"' }
         }
       >
          {(["climate", "lighting", "audio"] as PanelType[]).map((type) => {
            const isPrimary = type === focused;
            const role = isPrimary ? "primary" : (orderedContents[1] === type ? "top" : "bottom");
            return (
              <motion.div
                key={type}
                layout
                transition={cardLayoutTransition}
                style={{ gridArea: role }}
                className={`rounded-2xl border bg-card shadow-sm flex flex-col relative min-h-0 ${isPrimary ? "overflow-visible" : "overflow-hidden cursor-pointer hover:border-primary/50 transition-colors opacity-90 hover:opacity-100"}`}
                onClick={isPrimary ? undefined : () => setFocused(type)}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={isPrimary ? "expanded" : "compact"}
                    {...flowTransitionProps}
                    className={isPrimary
                      ? "absolute inset-0 w-full h-full p-5 md:p-8 flex flex-col overflow-visible"
                      : "absolute inset-0 w-full h-full p-5 md:p-6 flex flex-col justify-center overflow-y-auto"}
                  >
                    {renderContent(type, isPrimary)}
                  </motion.div>
                </AnimatePresence>
              </motion.div>
            );
          })}
       </div>

       {/* Shell 4: Light Colour Dedicated Panel (Now an overlay modal) */}
       <AnimatePresence>
          {focused === "lighting" && showColourPanel && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-6"
              onClick={() => setShowColourPanel(false)}
            >
              <motion.div
                initial={{ scale: 0.95, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 20, opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                className="w-full max-w-4xl rounded-3xl border border-border/50 bg-card shadow-2xl p-6 md:p-8 relative overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="absolute top-6 right-6 z-50">
                  <Button variant="ghost" size="icon" className="rounded-full hover:bg-muted" onClick={() => setShowColourPanel(false)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>
                <LightColourContent state={lighting} actions={{ setColor: (color: any) => setLighting(s => ({ ...s, color })), closeColourPanel: () => setShowColourPanel(false) }} />
              </motion.div>
            </motion.div>
          )}
       </AnimatePresence>
       <div className="h-6 shrink-0" />

       <AnimatePresence>
         {show3D && (
           <motion.div
             initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
             className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 md:p-6"
             onClick={() => setShow3D(false)}
           >
             <motion.div
               initial={{ scale: 0.95, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 20, opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.5 }}
               className="w-full max-w-5xl h-[85vh] rounded-3xl border border-border/50 overflow-hidden shadow-2xl relative"
               onClick={(e) => e.stopPropagation()}
             >
               <button
                 className="absolute top-4 right-4 z-50 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                 onClick={() => setShow3D(false)}
               >
                 <X className="w-4 h-4" />
               </button>
               <ThreeDView />
             </motion.div>
           </motion.div>
         )}
       </AnimatePresence>
    </div>
  );
}



