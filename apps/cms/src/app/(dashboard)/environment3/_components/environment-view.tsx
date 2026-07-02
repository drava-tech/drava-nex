"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Thermometer, Wind, Flame,
  Lightbulb, Sparkles, Copy, X,
  Speaker as SpeakerIcon, Settings2, Moon, Sun, Zap
} from "lucide-react";
import { Button, Badge } from "@platform/ui";
import { EnvironmentView as ThreeDView } from "../../environment5/_components/environment-view";

type PanelType = "climate" | "lighting" | "audio";

const transitionProps = {
  initial: { opacity: 0, scale: 0.95, filter: "blur(8px)", zIndex: 0 },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)", zIndex: 10 },
  exit: { opacity: 0, scale: 1.05, filter: "blur(8px)", zIndex: 0 },
  transition: { type: "spring", bounce: 0, duration: 0.6, opacity: { duration: 0.4 } } as any
};

const compactTransitionProps = {
  initial: { opacity: 0, scale: 1.05, filter: "blur(8px)", zIndex: 0 },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)", zIndex: 10 },
  exit: { opacity: 0, scale: 0.95, filter: "blur(8px)", zIndex: 0 },
  transition: { type: "spring", bounce: 0, duration: 0.6, opacity: { duration: 0.4 } } as any
};

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

function ClimateContent({ isExpanded, state, actions }: any) {
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

      <div className={`flex-1 flex flex-col justify-center transition-all duration-150 ${!state.power ? 'opacity-40 grayscale-[0.8] pointer-events-none' : ''}`}>
        {!isExpanded ? (
          <div className="flex flex-col pb-2">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black">{state.temp}°</span>
              <span className="text-muted-foreground text-sm font-bold uppercase tracking-wider">{state.mode}</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-0 py-2">
            <div className="relative w-44 h-44 flex items-center justify-center">
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
              <div className="relative w-32 h-32 rounded-full bg-card shadow-2xl flex flex-col items-center justify-center z-10 border border-border">
                <div className={`absolute inset-3 rounded-full blur-xl opacity-20 transition-colors duration-1000 ${state.temp > 24 ? 'bg-orange-500' : 'bg-cyan-500'} animate-pulse`} />
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
  const waveform = useMemo(() => Array.from({ length: 48 }, (_, i) =>
    Number(Math.max(10, Math.abs(Math.sin(i * 0.3) * 20 + Math.cos(i * 0.7) * 15 + 20)).toFixed(1))
  ), []);
  const [isDragging, setIsDragging] = useState(false);
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
          <div className="flex-1 flex flex-col justify-end gap-3 w-full min-h-0 py-2" onClick={noProp}>
            <div className="flex items-start justify-between">
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
              {waveform.map((h, i) => {
                const vol = state.muted ? 0 : state.volume;
                const isActive = (i / waveform.length) * 100 <= vol;
                return (
                  <div key={i} className={`flex-1 rounded-full transition-all duration-150 ${isActive ? 'bg-gradient-to-t from-blue-600 to-cyan-400 shadow-[0_0_8px_rgba(56,189,248,0.4)]' : 'bg-muted'}`}
                    style={{ height: `${h}%`, opacity: isActive ? 1 : 0.5 }} />
                );
              })}
            </div>
            <p className="text-center text-[9px] font-bold text-blue-500 tracking-widest uppercase opacity-60">Slide to adjust</p>
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

  // States
  const [climate, setClimate] = useState({ power: true, temp: 22, mode: "Dry", fan: 60 });
  const [lighting, setLighting] = useState({
    power: true,
    brightness: 49,
    activeScene: "Presentation",
    zones: { "Roof Lights": 64, "Wall Lights 1": 70, "Wall Lights 2": 74 },
    color: { r: 138, g: 92, b: 255, w: 100, hex: "#8A5CFF" }
  });
  const [audio, setAudio] = useState({ power: true, playing: true, volume: 45, muted: false, bass: 0, treble: 0 });

  // Global Quick Devices State
  const [globalPower, setGlobalPower] = useState({ ac: true, lights: true, audio: true });

  // Persistence
  useEffect(() => {
    setIsClient(true);
    const saved = localStorage.getItem("cms_last_environment_panel") as PanelType;
    if (saved && ["climate", "lighting", "audio"].includes(saved)) {
      setFocused(saved);
    }
  }, []);

  useEffect(() => {
    if (isClient && focused) localStorage.setItem("cms_last_environment_panel", focused);
  }, [focused, isClient]);

  // Order
  const orderedContents = [focused, ...(["climate", "lighting", "audio"] as PanelType[]).filter(x => x !== focused)];

  const renderContent = (type: PanelType, isExpanded: boolean) => {
    if (type === "climate") return <ClimateContent key="climate" isExpanded={isExpanded} state={climate} actions={{
      setTemp: (temp: number) => setClimate(s => ({ ...s, temp })),
      setMode: (mode: string) => setClimate(s => ({ ...s, mode })),
      setFan: (fan: number) => setClimate(s => ({ ...s, fan })),
      setPower: (power: boolean) => setClimate(s => ({ ...s, power })),
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

       <div className="flex-1 w-full flex flex-col lg:flex-row gap-6 min-h-0">
          
          {/* Left Column (68%) */}
          <div className="w-full lg:w-[68%] flex flex-col gap-6 min-h-0">
             {/* Shell 1: Primary Expanded */}
             <div className="w-full rounded-2xl border bg-card shadow-sm flex flex-col relative overflow-hidden flex-1 min-h-0">
                <AnimatePresence>
                  <motion.div key={orderedContents[0]} {...transitionProps} className="absolute inset-0 w-full h-full p-5 md:p-8 flex flex-col overflow-hidden">
                    {renderContent(orderedContents[0] as PanelType, true)}
                  </motion.div>
                </AnimatePresence>
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
          </div>

          {/* Right Column (32%) */}
          <div className="w-full lg:w-[32%] flex flex-col gap-6 min-h-0">
             
             {/* Shell 2: Compact Top */}
             <div 
               className="rounded-2xl border bg-card shadow-sm flex flex-col relative cursor-pointer hover:border-primary/50 transition-colors opacity-90 hover:opacity-100 flex-1 min-h-0 overflow-hidden"
               onClick={() => setFocused(orderedContents[1] as PanelType)}
             >
                <AnimatePresence>
                  <motion.div key={orderedContents[1]} {...compactTransitionProps} className="absolute inset-0 w-full h-full p-5 md:p-6 flex flex-col justify-center overflow-y-auto">
                    {renderContent(orderedContents[1] as PanelType, false)}
                  </motion.div>
                </AnimatePresence>
             </div>

             {/* Shell 3: Compact Bottom */}
             <div 
               className="rounded-2xl border bg-card shadow-sm flex flex-col relative cursor-pointer hover:border-primary/50 transition-colors opacity-90 hover:opacity-100 flex-1 min-h-0 overflow-hidden"
               onClick={() => setFocused(orderedContents[2] as PanelType)}
             >
                <AnimatePresence>
                  <motion.div key={orderedContents[2]} {...compactTransitionProps} className="absolute inset-0 w-full h-full p-5 md:p-6 flex flex-col justify-center overflow-y-auto">
                    {renderContent(orderedContents[2] as PanelType, false)}
                  </motion.div>
                </AnimatePresence>
             </div>

          </div>
       </div>
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
