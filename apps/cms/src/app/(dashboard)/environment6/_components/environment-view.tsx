"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Thermometer, Wind, Flame, Lightbulb, Sparkles, Copy, X,
  Speaker as SpeakerIcon, Settings2, Moon, Sun, Zap,
  Fan, CloudSnow, Timer, Snowflake, Droplets,
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
  Tv, Bluetooth, Usb, Disc, Play, Pause, SkipBack, SkipForward,
  VolumeX, Mic, Radio, Clock, BluetoothSearching, Monitor,
} from "lucide-react";
import { Button, Badge } from "@platform/ui";
import { EnvironmentView as ThreeDView } from "../../environment5/_components/environment-view";

type PanelType = "climate" | "lighting" | "audio";

const transitionProps = {
  initial: { opacity: 0, scale: 0.95, filter: "blur(8px)", zIndex: 0 },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)", zIndex: 10 },
  exit: { opacity: 0, scale: 1.05, filter: "blur(8px)", zIndex: 0 },
  transition: { type: "spring", bounce: 0, duration: 0.6, opacity: { duration: 0.4 } } as any,
};

const compactTransitionProps = {
  initial: { opacity: 0, scale: 1.05, filter: "blur(8px)", zIndex: 0 },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)", zIndex: 10 },
  exit: { opacity: 0, scale: 0.95, filter: "blur(8px)", zIndex: 0 },
  transition: { type: "spring", bounce: 0, duration: 0.6, opacity: { duration: 0.4 } } as any,
};

const tabTransition = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { type: "spring", bounce: 0, duration: 0.18 } as any,
};

const noProp = (e: React.SyntheticEvent) => e.stopPropagation();

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

const getPresetGlow = (name: string) => {
  switch (name) {
    case "Presentation": return "from-violet-500 to-fuchsia-500";
    case "Meeting":      return "from-blue-400 to-indigo-500";
    case "Demo":         return "from-orange-400 to-amber-500";
    case "Relax":        return "from-emerald-400 to-teal-500";
    case "Night":        return "from-slate-500 to-zinc-600";
    default:             return "from-zinc-400 to-zinc-600";
  }
};

// ─── Utils for colour picker ──────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1]!, 16), g: parseInt(result[2]!, 16), b: parseInt(result[3]!, 16) } : { r: 0, g: 0, b: 0 };
}
function rgbToHex(r: number, g: number, b: number) {
  return "#" + (1 << 24 | Math.round(r) << 16 | Math.round(g) << 8 | Math.round(b)).toString(16).slice(1).toUpperCase();
}
function hsvToRgb(h: number, s: number, v: number) {
  const f = (n: number, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) };
}
function rgbToHsv(r: number, g: number, b: number) {
  const v = Math.max(r, g, b), c = v - Math.min(r, g, b);
  const h = c && (v === r ? (g - b) / c : v === g ? 2 + (b - r) / c : 4 + (r - g) / c);
  return { h: 60 * (h < 0 ? h + 6 : h), s: v && c / v, v: v / 255 };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CLIMATE_PRESETS = [
  { name: "Presentation", emoji: "✦", temp: 22, mode: "Cool", fan: "Auto", eco: false, quiet: false, turbo: false, description: "22° · Cool · Auto Fan" },
  { name: "Meeting",      emoji: "👥", temp: 24, mode: "Cool", fan: "Low",  eco: true,  quiet: false, turbo: false, description: "24° · Cool · Low · Eco" },
  { name: "Demo",         emoji: "🚀", temp: 20, mode: "Cool", fan: "High", eco: false, quiet: false, turbo: false, description: "20° · Cool · High Fan" },
  { name: "Relax",        emoji: "😌", temp: 26, mode: "Auto", fan: "Low",  eco: true,  quiet: true,  turbo: false, description: "26° · Auto · Quiet" },
  { name: "Night",        emoji: "🌙", temp: 28, mode: "Dry",  fan: "Auto", eco: true,  quiet: true,  turbo: false, description: "28° · Dry · Quiet · Eco" },
];

const TIMER_OPTIONS = [
  { id: "0", label: "Off" },
  { id: "30", label: "30m" },
  { id: "60", label: "1h" },
  { id: "120", label: "2h" },
  { id: "240", label: "4h" },
  { id: "480", label: "8h" },
];

const AUDIO_SOURCES = [
  { id: "HDMI",      label: "HDMI",    icon: <Monitor className="w-4 h-4" /> },
  { id: "Bluetooth", label: "BT",      icon: <Bluetooth className="w-4 h-4" /> },
  { id: "TV",        label: "TV",      icon: <Tv className="w-4 h-4" /> },
  { id: "USB",       label: "USB",     icon: <Usb className="w-4 h-4" /> },
  { id: "Optical",   label: "Optical", icon: <Disc className="w-4 h-4" /> },
  { id: "ARC",       label: "ARC",     icon: <Tv className="w-4 h-4" /> },
];

const FAN_OPTIONS = [
  { id: "Auto",   label: "Auto", bars: [4, 6, 3, 7, 4, 5, 3, 6], animated: true },
  { id: "Low",    label: "Low",  bars: [2, 3, 2, 3, 2, 3, 2, 3], animated: false },
  { id: "Medium", label: "Med",  bars: [5, 6, 5, 7, 5, 6, 5, 7], animated: false },
  { id: "High",   label: "High", bars: [8, 9, 8, 9, 8, 9, 8, 9], animated: false },
];

const SOUND_PROFILES = [
  { id: "Cinema",   bars: [9, 7, 5, 4, 5, 7, 8, 9], glow: "from-purple-500 to-indigo-600",  description: "Deep immersive" },
  { id: "Music",    bars: [5, 6, 8, 9, 8, 7, 6, 5], glow: "from-emerald-400 to-teal-500",   description: "Natural balance" },
  { id: "Voice",    bars: [3, 4, 7, 9, 9, 7, 4, 3], glow: "from-blue-400 to-cyan-500",      description: "Clear dialogue" },
  { id: "Night",    bars: [3, 3, 4, 5, 5, 4, 3, 2], glow: "from-slate-400 to-zinc-500",     description: "Reduced peaks" },
  { id: "Standard", bars: [5, 5, 5, 5, 5, 5, 5, 5], glow: "from-zinc-400 to-zinc-600",      description: "Flat response" },
];

// ─── Shared Sub-components ────────────────────────────────────────────────────

function Switch({ checked, onChange }: { checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <div
      className={`w-11 h-6 rounded-full p-1 cursor-pointer transition-colors ${checked ? "bg-zinc-900 dark:bg-white" : "bg-zinc-200 dark:bg-zinc-700"}`}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
    >
      <motion.div
        className="w-4 h-4 rounded-full bg-white dark:bg-zinc-900 shadow-sm"
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      />
    </div>
  );
}

function MiniSlider({
  value, onChange, min = 0, max = 100, label, suffix = "%",
  color = "bg-zinc-900 dark:bg-white", format,
}: {
  value: number; onChange: (v: number) => void; min?: number; max?: number;
  label?: string; suffix?: string; color?: string; format?: (v: number) => string;
}) {
  const [dragging, setDragging] = useState(false);
  const display = format ? format(value) : `${value}${suffix}`;

  const pctFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.round(min + (Math.max(0, Math.min(e.clientX - rect.left, rect.width)) / rect.width) * (max - min));
  };

  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between items-center mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
          <span className="text-[11px] font-black text-foreground">{display}</span>
        </div>
      )}
      <div
        className="w-full h-3 bg-zinc-200 dark:bg-zinc-800 rounded-full relative cursor-pointer touch-none flex items-center shadow-inner"
        onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); onChange(pctFromEvent(e)); }}
        onPointerMove={(e) => { e.stopPropagation(); if (dragging) onChange(pctFromEvent(e)); }}
        onPointerUp={(e) => { e.stopPropagation(); e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); }}
        onPointerCancel={(e) => { e.stopPropagation(); setDragging(false); }}
      >
        <div className={`absolute left-0 h-full rounded-full ${color}`} style={{ width: `${pct}%`, transition: dragging ? "none" : "width 0.15s" }} />
        <motion.div
          className="absolute h-5 w-5 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.15)] rounded-full border border-zinc-200"
          animate={{ left: `calc(${pct}% - 10px)` }}
          transition={{ type: "spring", bounce: 0, duration: dragging ? 0 : 0.2 }}
        />
      </div>
    </div>
  );
}

function TabBar({ tabs, active, onChange, tabId }: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
  tabId: string;
}) {
  return (
    <div className="flex gap-1 p-1 bg-muted/50 rounded-xl shrink-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={(e) => { e.stopPropagation(); onChange(t.id); }}
          className={`relative flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-colors ${
            active === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
          }`}
        >
          {active === t.id && (
            <motion.div
              layoutId={`${tabId}-tab-pill`}
              className="absolute inset-0 bg-background shadow-sm rounded-lg"
              transition={{ type: "spring", bounce: 0, duration: 0.28 }}
            />
          )}
          <span className="relative z-10">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function SegmentedControl({ options, value, onChange, label }: {
  options: { id: string; label: string; icon?: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div>
      {label && <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 block">{label}</span>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={(e) => { e.stopPropagation(); onChange(o.id); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-150 ${
              value === o.id
                ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
            }`}
          >
            {o.icon && <span className="opacity-80">{o.icon}</span>}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange, description, icon }: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  description?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer select-none"
      onClick={(e) => { e.stopPropagation(); onChange(!value); }}
    >
      <div className="flex items-center gap-2.5">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <div>
          <span className="text-sm font-semibold">{label}</span>
          {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      <Switch checked={value} onChange={onChange} />
    </div>
  );
}

// ─── Premium Sub-components ───────────────────────────────────────────────────

function VolumeRing({ volume, muted, onVolumeChange }: { volume: number; muted: boolean; onVolumeChange: (v: number) => void }) {
  const r = 62;
  const C = 2 * Math.PI * r;
  const pct = muted ? 0 : volume / 100;
  const svgRef = React.useRef<SVGSVGElement>(null);
  const isDragging = React.useRef(false);

  const getVolumeFromPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    onVolumeChange(Math.min(100, Math.max(0, Math.round((angle / 360) * 100))));
  };

  return (
    <div className="relative w-40 h-40 shrink-0 flex items-center justify-center">
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full cursor-pointer touch-none"
        viewBox="0 0 160 160"
        onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); isDragging.current = true; getVolumeFromPointer(e); }}
        onPointerMove={(e) => { e.stopPropagation(); if (isDragging.current) getVolumeFromPointer(e); }}
        onPointerUp={(e) => { e.stopPropagation(); e.currentTarget.releasePointerCapture(e.pointerId); isDragging.current = false; }}
        onPointerCancel={(e) => { e.stopPropagation(); e.currentTarget.releasePointerCapture(e.pointerId); isDragging.current = false; }}
      >
        <circle cx="80" cy="80" r={r} fill="none" strokeWidth="8" stroke="currentColor" className="opacity-10"
          style={{ transform: "rotate(-90deg)", transformOrigin: "80px 80px" }} />
        <motion.circle
          cx="80" cy="80" r={r} fill="none" strokeWidth="8" stroke="currentColor" strokeLinecap="round"
          strokeDasharray={C}
          animate={{ strokeDashoffset: C * (1 - pct) }}
          transition={{ type: "spring", bounce: 0, duration: 0.4 } as any}
          style={{ transform: "rotate(-90deg)", transformOrigin: "80px 80px" }}
        />
      </svg>
      <div className="flex flex-col items-center justify-center z-10 pointer-events-none select-none">
        <span className="text-4xl font-black tracking-tighter leading-none">{muted ? "—" : volume}</span>
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground mt-1.5">{muted ? "Muted" : "Volume"}</span>
      </div>
    </div>
  );
}

function FanSpeedSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 block">Fan Speed</span>
      <div className="grid grid-cols-4 gap-2">
        {FAN_OPTIONS.map((opt) => {
          const isActive = value === opt.id;
          return (
            <button
              key={opt.id}
              onClick={(e) => { e.stopPropagation(); onChange(opt.id); }}
              className={`flex flex-col items-center gap-2 p-3 rounded-2xl transition-all duration-150 ${
                isActive ? "bg-zinc-900 dark:bg-white" : "bg-muted hover:bg-muted/80"
              }`}
            >
              <div className="flex items-end gap-[2px] h-8">
                {opt.bars.map((h, i) => (
                  <motion.div
                    key={i}
                    className={`w-[3px] rounded-full ${isActive ? "bg-white dark:bg-zinc-900" : "bg-muted-foreground/40"}`}
                    animate={isActive && opt.animated
                      ? { height: [`${h * 4}px`, `${Math.min(9, h + 2) * 4}px`, `${h * 4}px`] }
                      : { height: `${h * 4}px` }
                    }
                    transition={isActive && opt.animated
                      ? { duration: 0.55 + i * 0.05, repeat: Infinity, ease: "easeInOut" }
                      : { duration: 0.15 }
                    }
                  />
                ))}
              </div>
              <span className={`text-[10px] font-black uppercase tracking-widest ${isActive ? "text-white dark:text-zinc-900" : "text-muted-foreground"}`}>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SoundProfileCards({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 block">Sound Profile</span>
      <div className="grid grid-cols-5 gap-2">
        {SOUND_PROFILES.map((p) => {
          const isActive = value === p.id;
          return (
            <button
              key={p.id}
              onClick={(e) => { e.stopPropagation(); onChange(p.id); }}
              className={`relative flex flex-col items-center gap-2 p-3 rounded-2xl overflow-hidden transition-all duration-150 ${
                isActive ? "bg-zinc-900 dark:bg-white" : "bg-muted hover:bg-muted/80"
              }`}
            >
              {isActive && <div className={`absolute inset-0 bg-gradient-to-br ${p.glow} opacity-25`} />}
              <div className="flex items-end gap-[2px] h-8 relative z-10">
                {p.bars.map((h, i) => (
                  <div key={i} className={`w-[3px] rounded-full ${isActive ? "bg-white dark:bg-zinc-900" : "bg-muted-foreground/40"}`}
                    style={{ height: `${h * 4}px` }} />
                ))}
              </div>
              <span className={`text-[9px] font-black uppercase tracking-widest relative z-10 ${isActive ? "text-white dark:text-zinc-900" : "text-muted-foreground"}`}>{p.id}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ActiveFeatureStrip({ state }: { state: any }) {
  const chips = [
    { key: "eco",        label: "Eco",   active: state.eco,        color: "text-emerald-600 bg-emerald-500/10" },
    { key: "turbo",      label: "Turbo", active: state.turbo,      color: "text-orange-500 bg-orange-500/10" },
    { key: "quiet",      label: "Quiet", active: state.quiet,      color: "text-blue-500 bg-blue-500/10" },
    { key: "sleep",      label: "Sleep", active: state.sleep,      color: "text-indigo-500 bg-indigo-500/10" },
    { key: "aiMode",     label: "AI",    active: state.aiMode,     color: "text-violet-500 bg-violet-500/10" },
    { key: "frostFresh", label: "Frost", active: state.frostFresh, color: "text-cyan-500 bg-cyan-500/10" },
  ].filter((c) => c.active);

  if (chips.length === 0) return null;

  return (
    <div className="flex gap-1.5 flex-wrap shrink-0">
      {chips.map((c) => (
        <span key={c.key} className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${c.color}`}>{c.label}</span>
      ))}
    </div>
  );
}

// ─── Climate Content ──────────────────────────────────────────────────────────

function ClimateContent({ isExpanded, state, actions }: any) {
  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className="flex justify-between items-start shrink-0 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Thermometer className="w-4 h-4" />
          </div>
          <h3 className="font-semibold tracking-tight text-lg">Climate</h3>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest">
            {state.power ? "● Online" : "Off"}
          </Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      <div className={`flex-1 flex flex-col min-h-0 transition-all duration-150 ${!state.power ? "opacity-40 grayscale-[0.8] pointer-events-none" : ""}`}>
        {!isExpanded ? (
          <div className="flex flex-col gap-1 pb-2">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black">{state.temp}°</span>
            </div>
            <span className="text-[10px] font-medium text-muted-foreground">{state.fan} Fan</span>
          </div>
        ) : (
          <div className="grid grid-cols-[auto_1fr] gap-6 items-start h-full">
            {/* Left: Temp Dial + Turbo */}
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-44 h-44 flex items-center justify-center shrink-0">
                {Array.from({ length: 48 }).map((_, i) => {
                  const tickTemp = 15 + i / 3;
                  const isActive = tickTemp <= state.temp;
                  return (
                    <div key={i} className="absolute inset-0 pointer-events-none" style={{ transform: `rotate(${i * 7.5}deg)` }}>
                      <div className={`w-[2px] h-3 mx-auto rounded-full transition-colors duration-500 ${isActive
                        ? state.temp > 24 ? "bg-orange-500 shadow-[0_0_8px_#f97316]" : "bg-cyan-500 shadow-[0_0_8px_#06b6d4]"
                        : "bg-muted-foreground/20"}`} />
                    </div>
                  );
                })}
                <div className="relative w-32 h-32 rounded-full bg-card shadow-2xl flex flex-col items-center justify-center z-10 border border-border">
                  <div className={`absolute inset-3 rounded-full blur-xl opacity-20 transition-colors duration-1000 ${state.temp > 24 ? "bg-orange-500" : "bg-cyan-500"} animate-pulse`} />
                  <span className={`text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b ${getTempColor(state.temp)} relative z-10`}>
                    {state.temp}°
                  </span>
                  <span className="text-[9px] font-black text-muted-foreground tracking-widest uppercase mt-0.5 relative z-10">Target</span>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" size="icon" className="w-12 h-12 rounded-full" onClick={(e) => { noProp(e); actions.setTemp(Math.max(16, state.temp - 1)); }}>
                  <Wind className="w-5 h-5" />
                </Button>
                <Button variant="outline" size="icon" className="w-12 h-12 rounded-full" onClick={(e) => { noProp(e); actions.setTemp(Math.min(30, state.temp + 1)); }}>
                  <Flame className="w-5 h-5" />
                </Button>
              </div>
              <div className="w-full rounded-2xl border border-border overflow-hidden">
                <ToggleRow label="Turbo" description="Max cooling power" value={state.turbo} onChange={actions.setTurbo} icon={<Zap className="w-4 h-4" />} />
              </div>
            </div>

            {/* Right: Fan + Swing + Timer */}
            <div className="flex flex-col gap-5 pt-1">
              <FanSpeedSelector value={state.fan} onChange={actions.setFan} />

              <SegmentedControl
                label="Swing"
                value={state.swing}
                onChange={actions.setSwing}
                options={[
                  { id: "Off",        label: "Off" },
                  { id: "Vertical",   label: "Vert" },
                  { id: "Horizontal", label: "Horiz" },
                  { id: "Both",       label: "Both" },
                ]}
              />

              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-2">
                  <Timer className="w-3.5 h-3.5" />
                  Turn Off After
                </span>
                <SegmentedControl
                  value={String(state.offTimer)}
                  onChange={(v) => actions.setOffTimer(Number(v))}
                  options={TIMER_OPTIONS}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Lighting Content ─────────────────────────────────────────────────────────

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
          <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest">{state.power ? "● Online" : "Off"}</Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      <div className={`flex-1 flex flex-col justify-start transition-all duration-150 ${!state.power ? "opacity-40 grayscale-[0.8] pointer-events-none" : ""}`}>
        {!isExpanded ? (
          <div className="flex flex-col pb-2">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black">{state.brightness}%</span>
              <span className="text-muted-foreground text-sm font-bold uppercase tracking-wider">Brightness</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 pt-0 min-h-0">
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
            <div className="space-y-4 md:space-y-6">
              <div>
                <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2 block">Environment Scenes</span>
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  {[
                    { name: "Presentation", icon: <Sparkles className="w-5 h-5" /> },
                    { name: "Ambient",      icon: <Moon className="w-5 h-5" /> },
                    { name: "Focus",        icon: <Zap className="w-5 h-5" /> },
                    { name: "Relax",        icon: <Sun className="w-5 h-5" /> },
                  ].map((s) => {
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
                        {isActive && <div className={`absolute inset-0 opacity-20 dark:opacity-30 bg-gradient-to-br ${getSceneGlow(s.name)} animate-pulse`} />}
                        <div className={`mb-2 transition-transform duration-500 ${isActive ? "scale-110" : "group-hover/btn:scale-110"}`}>
                          <div className={`p-3 rounded-full ${isActive ? "text-white dark:text-zinc-900" : "text-muted-foreground"}`}>
                            {isActive ? (
                              <div className="relative">
                                {s.icon}
                                <div className={`absolute inset-0 blur-lg bg-gradient-to-tr ${getSceneGlow(s.name)} -z-10`} />
                              </div>
                            ) : s.icon}
                          </div>
                        </div>
                        <span className={`text-[10px] font-black tracking-widest uppercase transition-colors ${isActive ? "text-white dark:text-zinc-900" : "text-muted-foreground"}`}>{s.name}</span>
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

// ─── Light Colour Content ─────────────────────────────────────────────────────

function LightColourContent({ state, actions }: any) {
  const [hexInput, setHexInput] = useState(state.color.hex);
  const [mode, setMode] = useState<"RGBW" | "RGB">("RGBW");
  const [isValidHex, setIsValidHex] = useState(true);
  const pickerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => { setHexInput(state.color.hex); setIsValidHex(true); }, [state.color.hex]);

  const handleHexChange = (val: string) => { setHexInput(val); setIsValidHex(/^#[0-9A-F]{6}$/i.test(val)); };
  const handleHexApply = () => {
    if (isValidHex) { const { r, g, b } = hexToRgb(hexInput); actions.setColor({ ...state.color, r, g, b, hex: hexInput.toUpperCase() }); if (actions.closeColourPanel) actions.closeColourPanel(); }
  };
  const handleRgbChange = (channel: "r" | "g" | "b" | "w", val: number) => {
    const newColor = { ...state.color, [channel]: val };
    if (channel !== "w") newColor.hex = rgbToHex(newColor.r, newColor.g, newColor.b);
    actions.setColor(newColor);
  };
  const handlePickerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pickerRef.current) return;
    const rect = pickerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    const { r, g, b } = hsvToRgb((x / rect.width) * 360, 1, 1 - y / rect.height);
    actions.setColor({ ...state.color, r, g, b, hex: rgbToHex(r, g, b) });
  };
  const handleBrightnessChange = (pct: number) => {
    const currentMax = Math.max(state.color.r, state.color.g, state.color.b, state.color.w);
    if (currentMax === 0) { if (mode === "RGBW") { actions.setColor({ ...state.color, w: Math.round((pct / 100) * 255) }); } else { const val = Math.round((pct / 100) * 255); actions.setColor({ ...state.color, r: val, g: val, b: val, hex: rgbToHex(val, val, val) }); } return; }
    const scale = ((pct / 100) * 255) / currentMax;
    const r = Math.min(255, Math.round(state.color.r * scale)), g = Math.min(255, Math.round(state.color.g * scale)), b = Math.min(255, Math.round(state.color.b * scale)), w = Math.min(255, Math.round(state.color.w * scale));
    actions.setColor({ ...state.color, r, g, b, w, hex: rgbToHex(r, g, b) });
  };
  const hsv = rgbToHsv(state.color.r, state.color.g, state.color.b);
  const currentBrightness = Math.round((Math.max(state.color.r, state.color.g, state.color.b, state.color.w) / 255) * 100);

  return (
    <div className="flex flex-col z-10 relative text-card-foreground" onClick={noProp}>
      <div className="flex items-center gap-2 mb-8"><Settings2 className="w-5 h-5" /><h3 className="font-semibold tracking-tight text-lg uppercase">Light Colour</h3></div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="flex bg-zinc-100 dark:bg-zinc-900/50 p-1 rounded-xl w-fit relative">
            <div className="absolute top-1 bottom-1 w-20 rounded-lg bg-white dark:bg-zinc-800 shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ transform: mode === "RGBW" ? "translateX(0)" : "translateX(5rem)" }} />
            <button className={`relative z-10 h-8 w-20 text-xs font-bold transition-colors ${mode === "RGBW" ? "text-foreground" : "text-muted-foreground"}`} onClick={() => setMode("RGBW")}>RGBW</button>
            <button className={`relative z-10 h-8 w-20 text-xs font-bold transition-colors ${mode === "RGB" ? "text-foreground" : "text-muted-foreground"}`} onClick={() => { setMode("RGB"); handleRgbChange("w", 0); }}>RGB</button>
          </div>
          <div ref={pickerRef} className="w-full h-48 lg:h-56 rounded-2xl relative cursor-crosshair touch-none shadow-inner overflow-hidden" style={{ background: `linear-gradient(to bottom, transparent, black), linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)` }} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePickerDrag(e); }} onPointerMove={(e) => { if (e.buttons > 0) handlePickerDrag(e); }} onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}>
            <motion.div className="absolute w-5 h-5 rounded-full border-[2.5px] border-white shadow-[0_0_8px_rgba(0,0,0,0.6)] -ml-2.5 -mt-2.5 pointer-events-none" animate={{ left: `${(hsv.h / 360) * 100}%`, top: `${(1 - hsv.v) * 100}%` }} transition={{ type: "spring", bounce: 0, duration: 0.2 }} />
          </div>
          <div className="pt-2"><MiniSlider label="Brightness" min={0} max={100} suffix="%" value={currentBrightness} onChange={handleBrightnessChange} /></div>
        </div>
        <div className="lg:col-span-3 flex flex-col gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block">Preview</span>
          <motion.div className="w-full aspect-square md:aspect-[4/3] lg:aspect-[4/5] rounded-[24px] shadow-inner" animate={{ backgroundColor: state.color.hex, opacity: Math.max(0.2, currentBrightness / 100) }} transition={{ type: "spring", bounce: 0, duration: 0.3 }} />
        </div>
        <div className="lg:col-span-4 flex flex-col gap-8">
          <div><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-3">Hex Code</span><div className="flex items-center justify-between border border-border rounded-2xl px-5 py-4 bg-muted/30"><span className="font-mono font-black">{state.color.hex}</span><Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg hover:bg-muted"><Copy className="w-4 h-4 text-muted-foreground" /></Button></div></div>
          <div><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-3">Edit Hex Code</span>
            <div className="flex gap-3 items-start">
              <div className="flex-1 relative"><input type="text" value={hexInput} onChange={(e) => handleHexChange(e.target.value)} className={`w-full bg-transparent border ${isValidHex ? "border-border focus:border-primary" : "border-red-500 focus:border-red-500"} rounded-2xl px-5 text-sm font-mono focus:outline-none h-14 shadow-sm transition-colors`} />{!isValidHex && <span className="absolute -bottom-5 left-2 text-[10px] text-red-500 font-medium">Invalid HEX format</span>}</div>
              <Button size="sm" className="h-14 px-8 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-bold hover:opacity-90 disabled:opacity-50 transition-opacity" onClick={handleHexApply} disabled={!isValidHex}>Apply</Button>
            </div>
          </div>
          <div className="pt-2"><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-3">RGBW Values</span>
            <div className="flex items-center gap-1.5">
              {["r", "g", "b", "w"].map((c) => { if (mode === "RGB" && c === "w") return null; return (<div key={c} className="flex-1 flex flex-col items-center gap-1.5"><span className="text-[9px] font-bold uppercase text-muted-foreground">{c}</span><input type="number" min="0" max="255" step="any" value={state.color[c as "r" | "g" | "b" | "w"]} onChange={(e) => handleRgbChange(c as "r" | "g" | "b" | "w", parseFloat(e.target.value) || 0)} className="w-full px-0.5 bg-muted/50 border border-transparent focus:border-primary focus:bg-background rounded-xl h-12 text-center text-xs font-black focus:outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" /></div>); })}
              <div className="flex items-end pb-2 pl-1 shrink-0"><span className="text-muted-foreground font-black text-xs">%</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Audio Content ────────────────────────────────────────────────────────────

const AUDIO_TABS = [
  { id: "quick",    label: "Quick" },
  { id: "sound",    label: "Sound" },
  { id: "levels",   label: "Levels" },
  { id: "settings", label: "Settings" },
];

function AudioContent({ isExpanded, state, actions }: any) {
  const [tab, setTab] = useState<"quick" | "sound" | "levels" | "settings">("quick");

  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      {/* Header */}
      <div className="flex justify-between items-start shrink-0 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
            <SpeakerIcon className="w-4 h-4" />
          </div>
          <h3 className="font-semibold tracking-tight text-lg">Audio</h3>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest">
            {state.power ? (state.playing ? "● Playing" : "● Ready") : "Off"}
          </Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      {/* Body */}
      <div className={`flex-1 flex flex-col min-h-0 transition-all duration-150 ${!state.power ? "opacity-40 grayscale-[0.8] pointer-events-none" : ""}`}>
        {!isExpanded ? (
          /* Compact view */
          <div className="flex flex-col gap-1.5 pb-2">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black">{state.muted ? "—" : state.volume}</span>
              <span className="text-muted-foreground text-sm font-bold uppercase tracking-wider">{state.muted ? "Muted" : "Vol"}</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-muted px-2 py-0.5 rounded-full w-fit">{state.source}</span>
          </div>
        ) : (
          /* Expanded view with tabs */
          <div className="flex flex-col h-full min-h-0 gap-3">
            <TabBar tabId="audio" tabs={AUDIO_TABS} active={tab} onChange={(id) => setTab(id as any)} />

            <div className="flex-1 min-h-0 overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div key={tab} {...tabTransition} className="h-full">

                  {/* Quick Tab */}
                  {tab === "quick" && (
                    <div className="flex flex-col gap-5" onClick={noProp}>
                      {/* Volume Ring */}
                      <div className="flex items-center gap-6">
                        <VolumeRing
                          volume={state.volume}
                          muted={state.muted}
                          onVolumeChange={(v) => { actions.setVolume(v); actions.setMuted(false); }}
                        />
                        <div className="flex flex-col gap-3 flex-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Master Volume</span>
                            <button
                              onClick={(e) => { noProp(e); actions.setMuted(!state.muted); }}
                              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${state.muted ? "bg-red-500/10 text-red-500 ring-1 ring-red-500/20" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                            >
                              <VolumeX className="w-4 h-4" />
                            </button>
                          </div>
                          <p className="text-[9px] font-medium text-muted-foreground leading-relaxed">Drag the ring to adjust volume. Tap the mute button to silence output.</p>
                        </div>
                      </div>

                      {/* Input Source */}
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 block">Input Source</span>
                        <div className="flex gap-2 flex-wrap">
                          {AUDIO_SOURCES.map((src) => (
                            <button
                              key={src.id}
                              onClick={(e) => { noProp(e); actions.setSource(src.id); }}
                              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-150 ${
                                state.source === src.id
                                  ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm"
                                  : "bg-muted text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {src.icon}
                              <span className="text-[9px] font-black uppercase tracking-widest">{src.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Playback controls */}
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 block">Playback</span>
                        <div className="flex items-center gap-3">
                          <button onClick={(e) => { noProp(e); }} className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                            <SkipBack className="w-5 h-5" />
                          </button>
                          <button
                            onClick={(e) => { noProp(e); actions.setPlaying(!state.playing); }}
                            className="w-16 h-16 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center shadow-lg hover:scale-105 transition-transform"
                          >
                            {state.playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 translate-x-0.5" />}
                          </button>
                          <button onClick={(e) => { noProp(e); }} className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                            <SkipForward className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Sound Tab */}
                  {tab === "sound" && (
                    <div className="flex flex-col gap-5">
                      <SoundProfileCards value={state.soundMode} onChange={actions.setSoundMode} />

                      <div className="flex flex-col gap-4 pt-1">
                        <MiniSlider
                          label="Bass"
                          value={state.bass}
                          onChange={actions.setBass}
                          min={-10}
                          max={10}
                          format={(v) => v > 0 ? `+${v}` : `${v}`}
                          color="bg-blue-600"
                        />
                        <MiniSlider
                          label="Treble"
                          value={state.treble}
                          onChange={actions.setTreble}
                          min={-10}
                          max={10}
                          format={(v) => v > 0 ? `+${v}` : `${v}`}
                          color="bg-cyan-500"
                        />
                      </div>

                      <div className="rounded-2xl border border-border overflow-hidden">
                        <ToggleRow label="Virtual Surround" description="Simulates 7.1 surround sound" value={state.virtualSurround} onChange={actions.setVirtualSurround} icon={<Radio className="w-4 h-4" />} />
                        <ToggleRow label="Voice Enhancement" description="Boosts dialogue clarity" value={state.voiceEnhance} onChange={actions.setVoiceEnhance} icon={<Mic className="w-4 h-4" />} />
                        <ToggleRow label="Night Mode" description="Limits volume peaks for quiet listening" value={state.nightMode} onChange={actions.setNightMode} icon={<Moon className="w-4 h-4" />} />
                      </div>
                    </div>
                  )}

                  {/* Levels Tab */}
                  {tab === "levels" && (
                    <div className="flex flex-col gap-5">
                      <MiniSlider label="Subwoofer" value={state.subwoofer} onChange={actions.setSubwoofer} color="bg-zinc-900 dark:bg-white" />
                      <MiniSlider label="Center Channel" value={state.centerLevel} onChange={actions.setCenterLevel} color="bg-zinc-900 dark:bg-white" />
                      <MiniSlider label="Rear Speakers" value={state.rearLevel} onChange={actions.setRearLevel} color="bg-zinc-900 dark:bg-white" />
                      <MiniSlider label="Surround" value={state.surroundLevel} onChange={actions.setSurroundLevel} color="bg-zinc-900 dark:bg-white" />
                    </div>
                  )}

                  {/* Settings Tab */}
                  {tab === "settings" && (
                    <div className="flex flex-col gap-5">
                      <MiniSlider
                        label="Sync Delay"
                        value={state.syncDelay}
                        onChange={actions.setSyncDelay}
                        min={0}
                        max={300}
                        suffix="ms"
                        color="bg-zinc-900 dark:bg-white"
                      />

                      <div className="rounded-2xl border border-border overflow-hidden">
                        <ToggleRow label="Auto Standby" description="Power off after 30 min idle" value={state.autoStandby} onChange={actions.setAutoStandby} icon={<Clock className="w-4 h-4" />} />
                      </div>

                      <Button
                        variant="outline"
                        className="w-full rounded-xl h-12 font-bold text-sm flex items-center gap-2"
                        onClick={(e) => { noProp(e); }}
                      >
                        <BluetoothSearching className="w-4 h-4 text-blue-500" />
                        Bluetooth Pairing
                      </Button>
                    </div>
                  )}

                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EnvironmentView() {
  const [focused, setFocused] = useState<PanelType>("climate");
  const [isClient, setIsClient] = useState(false);
  const [showColourPanel, setShowColourPanel] = useState(false);
  const [show3D, setShow3D] = useState(false);

  const [climate, setClimate] = useState({
    power: true,
    temp: 22,
    mode: "Cool" as "Cool" | "Dry" | "Fan" | "Auto" | "Heat",
    fan: "Auto" as "Auto" | "Low" | "Medium" | "High",
    swing: "Off" as "Off" | "Vertical" | "Horizontal" | "Both",
    oscillation: "Medium" as "Slow" | "Medium" | "Fast",
    airDir: "Auto" as "Auto" | "Up" | "Down" | "Left" | "Right",
    turbo: false,
    eco: true,
    sleep: false,
    ifeelMode: false,
    aiMode: true,
    frostFresh: false,
    displayOn: true,
    quiet: false,
    draftGuard: false,
    offTimer: 0 as 0 | 30 | 60 | 120 | 240 | 480,
    preset: null as string | null,
  });

  const [lighting, setLighting] = useState({
    power: true,
    brightness: 49,
    activeScene: "Presentation",
    zones: { "Roof Lights": 64, "Wall Lights 1": 70, "Wall Lights 2": 74 },
    color: { r: 138, g: 92, b: 255, w: 100, hex: "#8A5CFF" },
  });

  const [audio, setAudio] = useState({
    power: true,
    volume: 45,
    muted: false,
    playing: true,
    source: "HDMI" as "HDMI" | "Bluetooth" | "TV" | "USB" | "Optical" | "ARC",
    soundMode: "Cinema" as "Cinema" | "Music" | "Voice" | "Night" | "Standard",
    bass: 2,
    treble: -1,
    subwoofer: 70,
    centerLevel: 60,
    rearLevel: 80,
    surroundLevel: 65,
    virtualSurround: true,
    voiceEnhance: false,
    nightMode: false,
    syncDelay: 120,
    autoStandby: true,
  });

  useEffect(() => {
    setIsClient(true);
    const saved = localStorage.getItem("cms_env6_panel") as PanelType;
    if (saved && ["climate", "lighting", "audio"].includes(saved)) setFocused(saved);
  }, []);

  useEffect(() => {
    if (isClient && focused) localStorage.setItem("cms_env6_panel", focused);
  }, [focused, isClient]);

  const orderedContents = [focused, ...(["climate", "lighting", "audio"] as PanelType[]).filter((x) => x !== focused)];

  const renderContent = (type: PanelType, isExpanded: boolean) => {
    if (type === "climate") return (
      <ClimateContent key="climate" isExpanded={isExpanded} state={climate} actions={{
        setPower:      (v: boolean) => setClimate((s) => ({ ...s, power: v })),
        setTemp:       (v: number) => setClimate((s) => ({ ...s, temp: v, preset: null })),
        setMode:       (v: string) => setClimate((s) => ({ ...s, mode: v as any, preset: null })),
        setFan:        (v: string) => setClimate((s) => ({ ...s, fan: v as any, preset: null })),
        setSwing:      (v: string) => setClimate((s) => ({ ...s, swing: v as any })),
        setOscillation:(v: string) => setClimate((s) => ({ ...s, oscillation: v as any })),
        setAirDir:     (v: string) => setClimate((s) => ({ ...s, airDir: v as any })),
        setOffTimer:   (v: number) => setClimate((s) => ({ ...s, offTimer: v as any })),
        setTurbo:      (v: boolean) => setClimate((s) => ({ ...s, turbo: v, ...(v && { eco: false, quiet: false, sleep: false }) })),
        setEco:        (v: boolean) => setClimate((s) => ({ ...s, eco: v, ...(v && { turbo: false }) })),
        setSleep:      (v: boolean) => setClimate((s) => ({ ...s, sleep: v, ...(v && { turbo: false }) })),
        setIfeelMode:  (v: boolean) => setClimate((s) => ({ ...s, ifeelMode: v })),
        setAiMode:     (v: boolean) => setClimate((s) => ({ ...s, aiMode: v })),
        setFrostFresh: (v: boolean) => setClimate((s) => ({ ...s, frostFresh: v })),
        setDisplayOn:  (v: boolean) => setClimate((s) => ({ ...s, displayOn: v })),
        setQuiet:      (v: boolean) => setClimate((s) => ({ ...s, quiet: v, ...(v && { turbo: false }) })),
        setDraftGuard: (v: boolean) => setClimate((s) => ({ ...s, draftGuard: v })),
        setPreset:     (p: any) => setClimate((s) => ({ ...s, temp: p.temp, mode: p.mode, fan: p.fan, eco: p.eco, quiet: p.quiet, turbo: p.turbo, preset: p.name })),
      }} />
    );
    if (type === "lighting") return (
      <LightingContent key="lighting" isExpanded={isExpanded} state={lighting} actions={{
        setPower:        (v: boolean) => setLighting((s) => ({ ...s, power: v })),
        setBrightness:   (v: number) => setLighting((s) => ({ ...s, brightness: v })),
        setZoneBrightness:(zone: string, v: number) => setLighting((s) => ({ ...s, zones: { ...s.zones, [zone]: v } })),
        setActiveScene:  (v: string) => setLighting((s) => ({ ...s, activeScene: v })),
        setColor:        (v: any) => setLighting((s) => ({ ...s, color: v })),
        toggleColourPanel: () => { setFocused("lighting"); setShowColourPanel((p) => !p); },
      }} />
    );
    if (type === "audio") return (
      <AudioContent key="audio" isExpanded={isExpanded} state={audio} actions={{
        setPower:        (v: boolean) => setAudio((s) => ({ ...s, power: v })),
        setVolume:       (v: number) => setAudio((s) => ({ ...s, volume: v })),
        setMuted:        (v: boolean) => setAudio((s) => ({ ...s, muted: v })),
        setPlaying:      (v: boolean) => setAudio((s) => ({ ...s, playing: v })),
        setSource:       (v: string) => setAudio((s) => ({ ...s, source: v as any })),
        setSoundMode:    (v: string) => setAudio((s) => ({ ...s, soundMode: v as any })),
        setBass:         (v: number) => setAudio((s) => ({ ...s, bass: v })),
        setTreble:       (v: number) => setAudio((s) => ({ ...s, treble: v })),
        setSubwoofer:    (v: number) => setAudio((s) => ({ ...s, subwoofer: v })),
        setCenterLevel:  (v: number) => setAudio((s) => ({ ...s, centerLevel: v })),
        setRearLevel:    (v: number) => setAudio((s) => ({ ...s, rearLevel: v })),
        setSurroundLevel:(v: number) => setAudio((s) => ({ ...s, surroundLevel: v })),
        setVirtualSurround:(v: boolean) => setAudio((s) => ({ ...s, virtualSurround: v })),
        setVoiceEnhance: (v: boolean) => setAudio((s) => ({ ...s, voiceEnhance: v })),
        setNightMode:    (v: boolean) => setAudio((s) => ({ ...s, nightMode: v })),
        setSyncDelay:    (v: number) => setAudio((s) => ({ ...s, syncDelay: v })),
        setAutoStandby:  (v: boolean) => setAudio((s) => ({ ...s, autoStandby: v })),
      }} />
    );
    return null;
  };

  if (!isClient) return null;

  return (
    <div className="w-full h-full flex flex-col gap-6 overflow-hidden font-sans text-foreground pb-2">
      <div className="flex justify-between items-center shrink-0 pt-2 pb-0">
        <div>
          <h1 className="text-3xl font-black tracking-tight mb-1">Environment Control</h1>
          <p className="text-muted-foreground font-medium">Climate, lighting, and audio management for the Experience Center.</p>
        </div>
        <Button variant="outline" className="rounded-xl font-bold tracking-widest text-xs uppercase" onClick={() => setShow3D(true)}>
          3D
        </Button>
      </div>

      <div className="flex-1 w-full flex flex-col lg:flex-row gap-6 min-h-0">
        {/* Left Column (68%) */}
        <div className="w-full lg:w-[68%] flex flex-col gap-6 min-h-0">
          <div className="w-full rounded-2xl border bg-card shadow-sm flex flex-col relative overflow-hidden flex-1 min-h-0">
            <AnimatePresence>
              <motion.div key={orderedContents[0]} {...transitionProps} className="absolute inset-0 w-full h-full p-5 md:p-8 flex flex-col overflow-hidden">
                {renderContent(orderedContents[0] as PanelType, true)}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Colour picker modal */}
          <AnimatePresence>
            {focused === "lighting" && showColourPanel && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-6"
                onClick={() => setShowColourPanel(false)}>
                <motion.div initial={{ scale: 0.95, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 20, opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                  className="w-full max-w-4xl rounded-3xl border border-border/50 bg-card shadow-2xl p-6 md:p-8 relative overflow-hidden"
                  onClick={(e) => e.stopPropagation()}>
                  <div className="absolute top-6 right-6 z-50">
                    <Button variant="ghost" size="icon" className="rounded-full hover:bg-muted" onClick={() => setShowColourPanel(false)}><X className="w-5 h-5" /></Button>
                  </div>
                  <LightColourContent state={lighting} actions={{ setColor: (c: any) => setLighting((s) => ({ ...s, color: c })), closeColourPanel: () => setShowColourPanel(false) }} />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column (32%) */}
        <div className="w-full lg:w-[32%] flex flex-col gap-6 min-h-0">
          <div className="rounded-2xl border bg-card shadow-sm flex flex-col relative cursor-pointer hover:border-primary/50 transition-colors opacity-90 hover:opacity-100 flex-1 min-h-0 overflow-hidden"
            onClick={() => setFocused(orderedContents[1] as PanelType)}>
            <AnimatePresence>
              <motion.div key={orderedContents[1]} {...compactTransitionProps} className="absolute inset-0 w-full h-full p-5 md:p-6 flex flex-col justify-center overflow-hidden">
                {renderContent(orderedContents[1] as PanelType, false)}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="rounded-2xl border bg-card shadow-sm flex flex-col relative cursor-pointer hover:border-primary/50 transition-colors opacity-90 hover:opacity-100 flex-1 min-h-0 overflow-hidden"
            onClick={() => setFocused(orderedContents[2] as PanelType)}>
            <AnimatePresence>
              <motion.div key={orderedContents[2]} {...compactTransitionProps} className="absolute inset-0 w-full h-full p-5 md:p-6 flex flex-col justify-center overflow-hidden">
                {renderContent(orderedContents[2] as PanelType, false)}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="h-6 shrink-0" />

      {/* 3D Modal */}
      <AnimatePresence>
        {show3D && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 md:p-6"
            onClick={() => setShow3D(false)}>
            <motion.div initial={{ scale: 0.95, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 20, opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.5 }}
              className="w-full max-w-5xl h-[85vh] rounded-3xl border border-border/50 overflow-hidden shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}>
              <button className="absolute top-4 right-4 z-50 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors" onClick={() => setShow3D(false)}>
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
