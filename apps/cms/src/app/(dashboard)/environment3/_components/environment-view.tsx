"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Thermometer, Wind, Flame, Droplets, Activity, Snowflake,
  Lightbulb, Sparkles, Copy,
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Music, Speaker as SpeakerIcon, Settings2, Moon, Sun, Zap
} from "lucide-react";
import { Button, Badge } from "@platform/ui";

type PanelType = "climate" | "lighting" | "audio";

const transitionProps = {
  initial: { opacity: 0, scale: 0.98, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: -10 },
  transition: { type: "spring", bounce: 0, duration: 0.4 } as any
};

const compactTransitionProps = {
  ...transitionProps,
  initial: { opacity: 0, scale: 0.98, x: 10 },
  exit: { opacity: 0, scale: 0.98, x: -10 }
};

const noProp = (e: React.SyntheticEvent) => e.stopPropagation();

// ─── UTILS ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1]!, 16), g: parseInt(result[2]!, 16), b: parseInt(result[3]!, 16) } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number) {
  return "#" + (1 << 24 | Math.round(r) << 16 | Math.round(g) << 8 | Math.round(b)).toString(16).slice(1).toUpperCase();
}

function hsvToRgb(h: number, s: number, v: number) {
  let f= (n:number,k=(n+h/60)%6) => v - v*s*Math.max( Math.min(k,4-k,1), 0);
  return { r: Math.round(f(5)*255), g: Math.round(f(3)*255), b: Math.round(f(1)*255) };
}

function rgbToHsv(r: number, g: number, b: number) {
  let v=Math.max(r,g,b), c=v-Math.min(r,g,b);
  let h= c && ((v==r) ? (g-b)/c : ((v==g) ? 2+(b-r)/c : 4+(r-g)/c)); 
  return { h: 60*(h<0?h+6:h), s: v&&c/v, v: v/255 };
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
        <Badge variant={state.power ? "default" : "secondary"} className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest">{state.power ? "● Online" : "Off"}</Badge>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        {!isExpanded ? (
          <div className="flex flex-col pb-2">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black">{state.temp}°</span>
              <span className="text-muted-foreground text-sm font-bold uppercase tracking-wider">{state.mode}</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-8 items-center pt-4">
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="w-48 h-48 rounded-full border-4 border-muted flex flex-col items-center justify-center relative">
                <div className="absolute inset-2 rounded-full border-4 border-primary/20 border-t-primary" style={{ transform: `rotate(${(state.temp-16)*10}deg)` }} />
                <span className="text-6xl font-black tracking-tighter">{state.temp}°</span>
                <span className="text-xs uppercase font-bold text-muted-foreground tracking-widest mt-1">Target</span>
              </div>
              <div className="flex gap-4">
                <Button variant="outline" size="icon" className="w-12 h-12 rounded-full" onClick={(e) => { noProp(e); actions.setTemp(Math.max(16, state.temp-1)); }}>
                  <Wind className="w-5 h-5" />
                </Button>
                <Button variant="outline" size="icon" className="w-12 h-12 rounded-full" onClick={(e) => { noProp(e); actions.setTemp(Math.min(30, state.temp+1)); }}>
                  <Flame className="w-5 h-5" />
                </Button>
              </div>
            </div>
            <div className="space-y-6">
              <div>
                 <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 block">System Mode</span>
                 <div className="grid grid-cols-2 gap-2" onClick={noProp}>
                    {["Cooling", "Heating", "Auto", "Dry"].map(m => (
                      <Button key={m} variant={state.mode === m ? "default" : "outline"} className="justify-start gap-2 rounded-xl h-12" onClick={() => actions.setMode(m)}>
                        {m === 'Cooling' ? <Snowflake className="w-4 h-4" /> : m === 'Heating' ? <Flame className="w-4 h-4" /> : m === 'Dry' ? <Droplets className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                        {m}
                      </Button>
                    ))}
                 </div>
              </div>
              <MiniSlider label="Fan Speed" value={state.fan} onChange={actions.setFan} max={100} suffix="%" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LightingContent({ isExpanded, state, actions, globalPowerActions, globalPowerState }: any) {
  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className="flex justify-between items-start shrink-0 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Lightbulb className="w-4 h-4" />
          </div>
          <h3 className="font-semibold tracking-tight text-lg">Lighting</h3>
        </div>
        <Badge variant={globalPowerState.lights ? "default" : "secondary"} className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest">{globalPowerState.lights ? "● Online" : "Off"}</Badge>
      </div>

      <div className="flex-1 flex flex-col justify-start">
        {!isExpanded ? (
          <div className="flex flex-col pb-2">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black">{state.brightness}%</span>
              <span className="text-muted-foreground text-sm font-bold uppercase tracking-wider">Brightness</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-2 pb-2 mt-2" onClick={noProp}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-start">
              
              {/* Left Column: Brightness Control */}
              <div className="space-y-6">
                 <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-4 block">Brightness Control</span>
                 <MiniSlider label="Master Brightness" value={state.brightness} onChange={actions.setBrightness} max={100} suffix="%" />
                 
                 <div className="space-y-6 mt-8">
                   {["Roof Lights", "Wall Lights 1", "Wall Lights 2"].map(zone => {
                     const storedVal = state.zones[zone] ?? 85;
                     const outputVal = Math.round((storedVal * state.brightness) / 100);
                     return (
                       <div key={zone}>
                          <div className="flex justify-between items-center mb-2">
                             <div className="flex items-center gap-2">
                               <span className="text-xs font-bold uppercase tracking-widest">{zone}</span>
                               <span className="text-[9px] uppercase font-bold text-muted-foreground bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded">{outputVal}% Out</span>
                             </div>
                             <span className="text-xs font-black text-foreground">{storedVal}%</span>
                          </div>
                          <MiniSlider value={storedVal} onChange={(v) => actions.setZoneBrightness(zone, v)} max={100} suffix="" label="" />
                       </div>
                     );
                   })}
                 </div>
              </div>
              
              {/* Right Column: Scenes & Devices */}
              <div className="space-y-8">
                 <div>
                   <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3 block">Environment Scenes</span>
                   <div className="grid grid-cols-2 gap-3">
                     {[
                       { name: "Presentation", icon: <Sparkles className="w-4 h-4" /> },
                       { name: "Ambient", icon: <Moon className="w-4 h-4" /> },
                       { name: "Focus", icon: <Zap className="w-4 h-4" /> },
                       { name: "Relax", icon: <Sun className="w-4 h-4" /> }
                     ].map(s => (
                       <Button key={s.name} variant={state.activeScene === s.name ? "default" : "outline"} className={`justify-start gap-2 rounded-xl h-12 shadow-none ${state.activeScene === s.name ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900' : ''}`} onClick={() => actions.setActiveScene(s.name)}>
                         <span className="opacity-70">{s.icon}</span>
                         <span className="truncate">{s.name}</span>
                       </Button>
                     ))}
                   </div>
                 </div>

                 <div>
                   <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3 block">Quick Devices</span>
                   <div className="space-y-2 border border-border rounded-2xl p-2 bg-card">
                      <div className="flex justify-between items-center px-3 py-2 rounded-xl hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <Snowflake className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">AC</span>
                        </div>
                        <Switch checked={globalPowerState.ac} onChange={(c) => globalPowerActions.setAc(c)} />
                      </div>
                      <div className="flex justify-between items-center px-3 py-2 rounded-xl hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <Lightbulb className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Total Lights</span>
                        </div>
                        <Switch checked={globalPowerState.lights} onChange={(c) => globalPowerActions.setLights(c)} />
                      </div>
                      <div className="flex justify-between items-center px-3 py-2 rounded-xl hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <SpeakerIcon className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Speakers</span>
                        </div>
                        <Switch checked={globalPowerState.audio} onChange={(c) => globalPowerActions.setAudio(c)} />
                      </div>
                   </div>
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
      const {r,g,b} = hexToRgb(hexInput);
      actions.setColor({ ...state.color, r, g, b, hex: hexInput.toUpperCase() });
    }
  };

  const handleRgbChange = (channel: 'r'|'g'|'b'|'w', val: number) => {
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
    
    const {r,g,b} = hsvToRgb(h, s, v);
    actions.setColor({ ...state.color, r, g, b, hex: rgbToHex(r, g, b) });
  };

  const handleBrightnessChange = (pct: number) => {
    const currentMax = Math.max(state.color.r, state.color.g, state.color.b, state.color.w);
    if (currentMax === 0) {
      if (mode === "RGBW") {
        actions.setColor({ ...state.color, w: Math.round((pct/100)*255) });
      } else {
        const val = Math.round((pct/100)*255);
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
                   {['r','g','b','w'].map(c => {
                     if (mode === "RGB" && c === 'w') return null;
                     return (
                       <div key={c} className="flex-1 flex flex-col items-center gap-1.5">
                          <span className="text-[9px] font-bold uppercase text-muted-foreground">{c}</span>
                          <input 
                            type="number" min="0" max="255" step="any"
                            value={state.color[c as 'r'|'g'|'b'|'w']}
                            onChange={(e) => handleRgbChange(c as 'r'|'g'|'b'|'w', parseFloat(e.target.value)||0)}
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

function AudioContent({ isExpanded, state, actions, globalPowerState }: any) {
  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className="flex justify-between items-start shrink-0 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
            <SpeakerIcon className="w-4 h-4" />
          </div>
          <h3 className="font-semibold tracking-tight text-lg">Audio</h3>
        </div>
        <Badge variant={globalPowerState.audio ? "default" : "secondary"} className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest">{globalPowerState.audio ? "● Playing" : "Off"}</Badge>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        {!isExpanded ? (
          <div className="flex flex-col pb-2">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black">{state.muted ? "Mute" : `${state.volume}%`}</span>
              <span className="text-muted-foreground text-sm font-bold uppercase tracking-wider">Volume</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center space-y-8 py-4" onClick={noProp}>
            <div className="text-center space-y-3 w-full max-w-sm">
               <div className="w-40 h-40 mx-auto rounded-3xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-border flex items-center justify-center shadow-inner">
                  <Music className="w-12 h-12 text-muted-foreground/30" />
               </div>
               <div>
                 <h4 className="text-xl font-bold tracking-tight">Ambient Mix Vol. 2</h4>
                 <p className="text-sm text-muted-foreground">Background Audio Source</p>
               </div>
            </div>
            <div className="flex items-center justify-center gap-6">
               <Button variant="ghost" size="icon" className="w-12 h-12 rounded-full"><SkipBack className="w-6 h-6" /></Button>
               <Button variant="default" size="icon" className="w-16 h-16 rounded-full shadow-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900" onClick={() => actions.setPlaying(!state.playing)}>
                  {state.playing ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
               </Button>
               <Button variant="ghost" size="icon" className="w-12 h-12 rounded-full"><SkipForward className="w-6 h-6" /></Button>
            </div>
            <div className="w-full max-w-md flex items-center gap-4">
               <Button variant="ghost" size="icon" className="shrink-0" onClick={() => actions.setMuted(!state.muted)}>
                  {state.muted || state.volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
               </Button>
               <MiniSlider value={state.muted ? 0 : state.volume} onChange={(v) => { actions.setVolume(v); actions.setMuted(false); }} suffix="%" label="" />
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

  // States
  const [climate, setClimate] = useState({ power: true, temp: 22, mode: "Dry", fan: 60 });
  const [lighting, setLighting] = useState({ 
    power: true, 
    brightness: 49, 
    activeScene: "Presentation",
    zones: { "Roof Lights": 64, "Wall Lights 1": 70, "Wall Lights 2": 74 },
    color: { r: 138, g: 92, b: 255, w: 100, hex: "#8A5CFF" }
  });
  const [audio, setAudio] = useState({ power: true, playing: true, volume: 45, muted: false });

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
    }} />;
    if (type === "audio") return <AudioContent key="audio" isExpanded={isExpanded} state={audio} globalPowerState={globalPower} actions={{
      setPlaying: (playing: boolean) => setAudio(s => ({ ...s, playing })),
      setVolume: (volume: number) => setAudio(s => ({ ...s, volume })),
      setMuted: (muted: boolean) => setAudio(s => ({ ...s, muted })),
      setPower: (power: boolean) => setAudio(s => ({ ...s, power })),
    }} />;
    return null;
  };

  if (!isClient) return null;

  return (
    <div className="w-full h-full flex flex-col gap-6 overflow-y-auto overflow-x-hidden font-sans text-foreground">
       
       <div className="flex justify-between items-center shrink-0 pt-2 pb-2">
          <div>
            <h1 className="text-3xl font-black tracking-tight mb-1">Environment Control</h1>
            <p className="text-muted-foreground font-medium">Manage workspace climate, lighting, audio, and devices.</p>
          </div>
       </div>

       <div className="flex-1 w-full flex flex-col lg:flex-row gap-6 min-h-0">
          
          {/* Left Column (68%) */}
          <div className="w-full lg:w-[68%] flex flex-col gap-6">
            {/* Shell 1: Primary Expanded */}
            <div className="w-full rounded-2xl border bg-card shadow-sm flex flex-col relative overflow-hidden transition-all duration-700">
               <AnimatePresence mode="wait">
                 <motion.div key={orderedContents[0]} {...transitionProps} className="p-6 md:p-8 flex flex-col min-h-[400px]">
                   {renderContent(orderedContents[0] as PanelType, true)}
                 </motion.div>
               </AnimatePresence>
            </div>
            
            {/* Shell 4: Light Colour Dedicated Panel (Only visible if Lighting is focused, matching image) */}
            <AnimatePresence mode="wait">
               {focused === "lighting" && (
                 <motion.div 
                   initial={{ opacity: 0, height: 0, scale: 0.98, y: -20 }} animate={{ opacity: 1, height: 'auto', scale: 1, y: 0 }} exit={{ opacity: 0, height: 0, scale: 0.98, y: -20 }} transition={{ type: "spring", bounce: 0, duration: 0.4 }}
                   className="w-full rounded-2xl border bg-card shadow-sm p-6 md:p-8 relative overflow-hidden"
                 >
                   <LightColourContent state={lighting} actions={{ setColor: (color: any) => setLighting(s => ({ ...s, color })) }} />
                 </motion.div>
               )}
            </AnimatePresence>
          </div>

          {/* Right Column (32%) */}
          <div className="w-full lg:w-[32%] flex flex-col gap-6 min-h-0">
             
             {/* Shell 2: Compact Top */}
             <div 
               className="rounded-2xl border bg-card shadow-sm flex flex-col relative cursor-pointer hover:border-primary/50 transition-colors opacity-90 hover:opacity-100"
               onClick={() => setFocused(orderedContents[1] as PanelType)}
             >
                <AnimatePresence mode="wait">
                  <motion.div key={orderedContents[1]} {...compactTransitionProps} className="p-5 md:p-6">
                    {renderContent(orderedContents[1] as PanelType, false)}
                  </motion.div>
                </AnimatePresence>
             </div>

             {/* Shell 3: Compact Bottom */}
             <div 
               className="rounded-2xl border bg-card shadow-sm flex flex-col relative cursor-pointer hover:border-primary/50 transition-colors opacity-90 hover:opacity-100"
               onClick={() => setFocused(orderedContents[2] as PanelType)}
             >
                <AnimatePresence mode="wait">
                  <motion.div key={orderedContents[2]} {...compactTransitionProps} className="p-5 md:p-6">
                    {renderContent(orderedContents[2] as PanelType, false)}
                  </motion.div>
                </AnimatePresence>
             </div>

          </div>
       </div>
       <div className="h-6 shrink-0" />
    </div>
  );
}
