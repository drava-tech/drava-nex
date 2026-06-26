"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Thermometer, Wind, Flame, Droplets, Activity, Snowflake,
  Lightbulb, Power, Sparkles,
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Minimize2, Music, Speaker as SpeakerIcon
} from "lucide-react";
import { Button, Badge, cn } from "@platform/ui";

type PanelType = "climate" | "lighting" | "audio";
type FocusedPanel = PanelType | null;

const noProp = (e: React.SyntheticEvent) => e.stopPropagation();

// ─── SLIDER ──────────────────────────────────────────────────────────────────

function MiniSlider({ value, onChange, min = 0, max = 100, label }: { value: number, onChange: (v: number) => void, min?: number, max?: number, label?: string }) {
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
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className="text-sm font-bold text-foreground">{value}{max > 50 ? '%' : '°'}</span>
        </div>
      )}
      <div 
        className="w-full h-8 bg-muted rounded-lg relative overflow-hidden cursor-pointer touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div 
          className="h-full bg-primary absolute left-0 top-0"
          style={{ width: `${pct}%`, transition: dragging ? 'none' : 'width 0.15s' }}
        />
      </div>
    </div>
  );
}

// ─── RENDERERS ────────────────────────────────────────────────────────────────

// 1. CLIMATE
function ClimateContent({ isExpanded, isCompact, state, actions }: any) {
  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className="flex justify-between items-start shrink-0 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Thermometer className="w-4 h-4" />
          </div>
          <h3 className="font-semibold tracking-tight text-lg">Climate</h3>
        </div>
        <Badge variant={state.power ? "default" : "secondary"}>{state.power ? "Online" : "Off"}</Badge>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        {!isExpanded ? (
          <div className="flex flex-col">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black">{state.temp}°</span>
              <span className="text-muted-foreground text-sm font-semibold uppercase tracking-wider">{state.mode}</span>
            </div>
            {!isCompact && <p className="text-sm text-muted-foreground mt-2">Target reached. Fan speed auto.</p>}
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            {/* Left */}
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
            {/* Right */}
            <div className="space-y-6">
              <div>
                 <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">System Mode</span>
                 <div className="grid grid-cols-2 gap-2" onClick={noProp}>
                    {["Cooling", "Heating", "Auto", "Dry"].map(m => (
                      <Button key={m} variant={state.mode === m ? "default" : "outline"} className="justify-start gap-2" onClick={() => actions.setMode(m)}>
                        {m === 'Cooling' ? <Snowflake className="w-4 h-4" /> : m === 'Heating' ? <Flame className="w-4 h-4" /> : m === 'Dry' ? <Droplets className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                        {m}
                      </Button>
                    ))}
                 </div>
              </div>
              <MiniSlider label="Fan Speed" value={state.fan} onChange={actions.setFan} max={100} />
              <div className="flex items-center justify-between border-t border-border pt-4">
                 <span className="text-sm font-medium">Main Power</span>
                 <Button variant={state.power ? "destructive" : "secondary"} onClick={(e) => { noProp(e); actions.setPower(!state.power); }}>
                   <Power className="w-4 h-4 mr-2" />{state.power ? "Turn Off" : "Turn On"}
                 </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 2. LIGHTING
function LightingContent({ isExpanded, isCompact, state, actions }: any) {
  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className="flex justify-between items-start shrink-0 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
            <Lightbulb className="w-4 h-4" />
          </div>
          <h3 className="font-semibold tracking-tight text-lg">Lighting</h3>
        </div>
        <Badge variant={state.power ? "default" : "secondary"}>{state.power ? "Online" : "Off"}</Badge>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        {!isExpanded ? (
          <div className="flex flex-col">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black">{state.brightness}%</span>
              <span className="text-muted-foreground text-sm font-semibold uppercase tracking-wider">Brightness</span>
            </div>
            {!isCompact && <p className="text-sm text-muted-foreground mt-2">Active Scene: <strong className="text-foreground">{state.activeScene}</strong></p>}
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 h-full items-start" onClick={noProp}>
            {/* Left */}
            <div className="space-y-4 overflow-y-auto pr-2 pb-2">
               <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">DALI Zones</span>
               <div className="bg-primary/5 rounded-lg p-4 border border-primary/10 mb-6">
                  <MiniSlider label="Master Brightness" value={state.brightness} onChange={actions.setBrightness} max={100} />
               </div>
               
               {["Roof Lights", "Wall Lights 1", "Wall Lights 2"].map(zone => {
                 const storedVal = state.zones[zone] ?? 85;
                 const outputVal = Math.round((storedVal * state.brightness) / 100);
                 return (
                   <div key={zone} className="bg-muted/50 rounded-lg p-3 border border-border">
                      <div className="flex justify-between items-center mb-3">
                         <div className="flex items-center gap-2">
                           <span className="text-sm font-medium">{zone}</span>
                           <span className="text-[10px] uppercase font-bold text-muted-foreground bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded">{outputVal}% Out</span>
                         </div>
                         <span className="text-xs font-bold text-foreground">{storedVal}%</span>
                      </div>
                      <MiniSlider value={storedVal} onChange={(v) => actions.setZoneBrightness(zone, v)} max={100} />
                   </div>
                 );
               })}
            </div>
            {/* Right */}
            <div className="space-y-6">
               <div>
                 <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Environment Scenes</span>
                 <div className="grid grid-cols-2 gap-2">
                   {["Presentation", "Ambient", "Focus", "Relax"].map(s => (
                     <Button key={s} variant={state.activeScene === s ? "default" : "outline"} className="justify-start gap-2 h-auto py-3" onClick={() => actions.setActiveScene(s)}>
                       <Sparkles className="w-4 h-4 shrink-0 opacity-50" />
                       <span className="truncate">{s}</span>
                     </Button>
                   ))}
                 </div>
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 3. AUDIO
function AudioContent({ isExpanded, isCompact, state, actions }: any) {
  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className="flex justify-between items-start shrink-0 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
            <SpeakerIcon className="w-4 h-4" />
          </div>
          <h3 className="font-semibold tracking-tight text-lg">Audio</h3>
        </div>
        <Badge variant="default">{state.playing ? "Playing" : "Paused"}</Badge>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        {!isExpanded ? (
          <div className="flex flex-col">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black">{state.muted ? "Mute" : `${state.volume}%`}</span>
              <span className="text-muted-foreground text-sm font-semibold uppercase tracking-wider">Volume</span>
            </div>
            {!isCompact && (
              <p className="text-sm text-muted-foreground mt-2 truncate flex items-center gap-1">
                <Music className="w-3 h-3" /> Ambient Mix Vol. 2
              </p>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center space-y-8 flex-1 py-4" onClick={noProp}>
            {/* Art & Info */}
            <div className="text-center space-y-3 w-full max-w-sm">
               <div className="w-40 h-40 mx-auto rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-border flex items-center justify-center shadow-inner">
                  <Music className="w-12 h-12 text-muted-foreground/30" />
               </div>
               <div>
                 <h4 className="text-xl font-bold tracking-tight">Ambient Mix Vol. 2</h4>
                 <p className="text-sm text-muted-foreground">Background Audio Source</p>
               </div>
            </div>
            {/* Playback Controls */}
            <div className="flex items-center justify-center gap-6">
               <Button variant="ghost" size="icon" className="w-12 h-12 rounded-full"><SkipBack className="w-6 h-6" /></Button>
               <Button variant="default" size="icon" className="w-16 h-16 rounded-full shadow-lg" onClick={() => actions.setPlaying(!state.playing)}>
                  {state.playing ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
               </Button>
               <Button variant="ghost" size="icon" className="w-12 h-12 rounded-full"><SkipForward className="w-6 h-6" /></Button>
            </div>
            {/* Volume */}
            <div className="w-full max-w-md flex items-center gap-4">
               <Button variant="ghost" size="icon" className="shrink-0" onClick={() => actions.setMuted(!state.muted)}>
                  {state.muted || state.volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
               </Button>
               <MiniSlider value={state.muted ? 0 : state.volume} onChange={(v) => { actions.setVolume(v); actions.setMuted(false); }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export function EnvironmentView() {
  const [focused, setFocused] = useState<FocusedPanel>(null);

  // Lifted States
  const [climate, setClimate] = useState({ power: true, temp: 22, mode: "Cooling", fan: 60 });
  const [lighting, setLighting] = useState({ 
    power: true, 
    brightness: 85, 
    activeScene: "Presentation",
    zones: { "Roof Lights": 85, "Wall Lights 1": 85, "Wall Lights 2": 85 }
  });
  const [audio, setAudio] = useState({ playing: true, volume: 45, muted: false });

  // Escape key support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocused(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Determine the mapping of content to the 3 static shell blocks.
  // Shell 1 (Left/Main), Shell 2 (Right Top), Shell 3 (Right Bottom)
  const orderedContents = (focused
    ? [focused, ...(["climate", "lighting", "audio"] as PanelType[]).filter(x => x !== focused)]
    : ["climate", "lighting", "audio"]) as [PanelType, PanelType, PanelType];

  const renderContent = (type: PanelType, isExpanded: boolean, isCompact: boolean) => {
    if (type === "climate") return <ClimateContent key="climate" isExpanded={isExpanded} isCompact={isCompact} state={climate} actions={{
      setTemp: (temp: number) => setClimate(s => ({ ...s, temp })),
      setMode: (mode: string) => setClimate(s => ({ ...s, mode })),
      setFan: (fan: number) => setClimate(s => ({ ...s, fan })),
      setPower: (power: boolean) => setClimate(s => ({ ...s, power })),
    }} />;
    if (type === "lighting") return <LightingContent key="lighting" isExpanded={isExpanded} isCompact={isCompact} state={lighting} actions={{
      setBrightness: (brightness: number) => setLighting(s => ({ ...s, brightness })),
      setZoneBrightness: (zone: string, brightness: number) => setLighting(s => ({ ...s, zones: { ...s.zones, [zone]: brightness } })),
      setActiveScene: (activeScene: string) => setLighting(s => ({ ...s, activeScene })),
      setPower: (power: boolean) => setLighting(s => ({ ...s, power })),
    }} />;
    if (type === "audio") return <AudioContent key="audio" isExpanded={isExpanded} isCompact={isCompact} state={audio} actions={{
      setPlaying: (playing: boolean) => setAudio(s => ({ ...s, playing })),
      setVolume: (volume: number) => setAudio(s => ({ ...s, volume })),
      setMuted: (muted: boolean) => setAudio(s => ({ ...s, muted })),
    }} />;
    return null;
  };

  return (
    <div className="w-full h-full flex flex-col gap-6 overflow-hidden">
       {/* Header */}
       <div className="flex justify-between items-center shrink-0 pt-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Environment Control</h1>
            <p className="text-muted-foreground mt-1">Manage workspace climate, lighting, and audio.</p>
          </div>
          <AnimatePresence>
            {focused && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, x: 10 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95, x: 10 }}
              >
                <Button variant="outline" onClick={() => setFocused(null)} className="gap-2 shadow-sm rounded-full px-6">
                  <Minimize2 className="h-4 w-4" />
                  Back to overview
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
       </div>

       {/* Static Shells with Cross-fading Content */}
       <div className={cn(
         "flex-1 w-full flex flex-col md:flex-row gap-4 md:gap-6 min-h-0 transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
       )}>
          {/* Shell 1: Always Main/Expanded */}
          <div 
            className={cn(
              "rounded-xl border bg-card text-card-foreground shadow-sm flex flex-col overflow-hidden relative transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
              focused ? "w-full md:w-[75%]" : "w-full md:w-1/3 cursor-pointer hover:border-primary/50"
            )}
            onClick={() => !focused && setFocused(orderedContents[0])}
          >
             <AnimatePresence mode="wait">
               <motion.div 
                 key={orderedContents[0] + (focused ? "-expanded" : "-overview")}
                 initial={{ opacity: 0, filter: "blur(4px)" }}
                 animate={{ opacity: 1, filter: "blur(0px)" }}
                 exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.2 } }}
                 transition={{ duration: 0.4 }}
                 className="absolute inset-0 p-6"
               >
                 {renderContent(orderedContents[0], !!focused, false)}
               </motion.div>
             </AnimatePresence>
          </div>

          {/* Shell 2 & 3 Container */}
          <div className={cn(
            "flex flex-col gap-4 md:gap-6 transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
            focused ? "w-full md:w-[25%]" : "w-full md:w-2/3 md:flex-row"
          )}>
             {/* Shell 2 */}
             <div 
               className={cn(
                 "flex-1 rounded-xl border bg-card text-card-foreground shadow-sm flex flex-col overflow-hidden relative cursor-pointer hover:border-primary/50 transition-colors",
                 focused && "opacity-85 hover:opacity-100"
               )}
               onClick={() => setFocused(orderedContents[1])}
             >
                <AnimatePresence mode="wait">
                  <motion.div 
                    key={orderedContents[1] + (focused ? "-compact" : "-overview")}
                    initial={{ opacity: 0, filter: "blur(4px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.2 } }} transition={{ duration: 0.4 }}
                    className="absolute inset-0 p-6"
                  >
                    {renderContent(orderedContents[1], false, !!focused)}
                  </motion.div>
                </AnimatePresence>
             </div>

             {/* Shell 3 */}
             <div 
               className={cn(
                 "flex-1 rounded-xl border bg-card text-card-foreground shadow-sm flex flex-col overflow-hidden relative cursor-pointer hover:border-primary/50 transition-colors",
                 focused && "opacity-85 hover:opacity-100"
               )}
               onClick={() => setFocused(orderedContents[2])}
             >
                <AnimatePresence mode="wait">
                  <motion.div 
                    key={orderedContents[2] + (focused ? "-compact" : "-overview")}
                    initial={{ opacity: 0, filter: "blur(4px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.2 } }} transition={{ duration: 0.4 }}
                    className="absolute inset-0 p-6"
                  >
                    {renderContent(orderedContents[2], false, !!focused)}
                  </motion.div>
                </AnimatePresence>
             </div>
          </div>
       </div>
    </div>
  );
}
