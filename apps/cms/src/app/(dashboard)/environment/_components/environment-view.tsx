"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Lightbulb, Volume2, Thermometer, Sparkles, Wind, Flame, Power, Droplets, Zap, Sun, Moon, Settings2 } from "lucide-react";

// Helper for dynamic temperature color
const getTempColor = (temp: number) => {
  if (temp < 20) return "from-cyan-400 to-blue-600 shadow-[0_0_30px_rgba(6,182,212,0.5)] text-cyan-400";
  if (temp < 24) return "from-emerald-400 to-teal-600 shadow-[0_0_30px_rgba(16,185,129,0.5)] text-emerald-400";
  if (temp < 27) return "from-orange-400 to-amber-600 shadow-[0_0_30px_rgba(249,115,22,0.5)] text-orange-400";
  return "from-rose-500 to-red-600 shadow-[0_0_30px_rgba(225,29,72,0.5)] text-rose-500";
};

const getLightingGlow = (mode: string) => {
  switch (mode) {
    case "Interactive": return "from-violet-500 to-fuchsia-500 shadow-[0_0_30px_rgba(167,139,250,0.8)]";
    case "Focus": return "from-blue-400 to-cyan-500 shadow-[0_0_30px_rgba(56,189,248,0.8)]";
    case "Relax": return "from-emerald-400 to-teal-500 shadow-[0_0_30px_rgba(52,211,153,0.8)]";
    case "Energy": return "from-amber-400 to-orange-500 shadow-[0_0_30px_rgba(251,191,36,0.8)]";
    case "Night": return "from-indigo-600 to-purple-800 shadow-[0_0_30px_rgba(79,70,229,0.8)]";
    default: return "from-zinc-400 to-zinc-600 shadow-[0_0_30px_rgba(161,161,170,0.8)]";
  }
};

const lightingIcons: Record<string, React.ReactNode> = {
  "Interactive": <Sparkles className="w-6 h-6" />,
  "Focus": <Zap className="w-6 h-6" />,
  "Relax": <Droplets className="w-6 h-6" />,
  "Energy": <Sun className="w-6 h-6" />,
  "Night": <Moon className="w-6 h-6" />,
  "Custom": <Settings2 className="w-6 h-6" />
};

export function EnvironmentView() {
  // Global Power State
  const [isPowerOn, setIsPowerOn] = useState(true);

  // Lighting Mode State
  const [activeLightingMode, setActiveLightingMode] = useState("Interactive");
  const lightingModes = ["Interactive", "Focus", "Relax", "Energy", "Night", "Custom"];

  // Speaker Volume State (0 to 100)
  const [volume, setVolume] = useState(65);
  const [isVolumeDragging, setIsVolumeDragging] = useState(false);

  // Generate a static beautiful waveform array
  const waveform = useMemo(() => {
    return Array.from({ length: 48 }, (_, i) => {
      // Create a nice looking artificial wave using sine functions
      const wave1 = Math.sin(i * 0.3) * 20;
      const wave2 = Math.cos(i * 0.7) * 15;
      const base = 20;
      return Math.max(10, Math.abs(wave1 + wave2 + base));
    });
  }, []);

  // EQ Pulse State (reacts to volume)
  const [eqPulse, setEqPulse] = useState(1);
  useEffect(() => {
    if (!isPowerOn || volume === 0) {
      setEqPulse(1);
      return;
    }
    const interval = setInterval(() => {
      setEqPulse(1 + (Math.random() * (volume / 100) * 0.15));
    }, 150);
    return () => clearInterval(interval);
  }, [volume, isPowerOn]);

  // Temperature State (16 to 30)
  const [temperature, setTemperature] = useState(22);

  const updateVolumeFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPowerOn) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pct = Math.round((x / rect.width) * 100);
    setVolume(pct);
  };

  const handleVolumePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsVolumeDragging(true);
    updateVolumeFromEvent(e);
  };

  const handleVolumePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isVolumeDragging) updateVolumeFromEvent(e);
  };

  const handleVolumePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsVolumeDragging(false);
  };

  return (
    <div className="w-full h-full flex flex-col select-none py-2 px-4 md:px-8 bg-zinc-50 dark:bg-[#050505] relative overflow-hidden font-sans">

      {/* Immersive Synesthesia Background */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-screen opacity-60 dark:opacity-80 transition-transform duration-150 ease-out"
        style={{ transform: `scale(${eqPulse})` }}
      >
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-violet-600/20 blur-[140px] rounded-full animate-[spin_40s_linear_infinite]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[140px] rounded-full animate-[spin_50s_linear_infinite_reverse]" />
        <div className={`absolute top-[20%] right-[20%] w-[40%] h-[40%] blur-[140px] rounded-full transition-colors duration-1000 ${temperature > 24 ? 'bg-orange-600/20' : 'bg-cyan-600/20'} animate-[spin_35s_linear_infinite]`} />
      </div>

      {/* Header Panel */}
      <div className="flex items-center justify-between mb-4 mt-1 relative z-10 drop-shadow-sm">
        <div className="flex flex-col">
          <div className="flex items-center gap-3 mb-1">
            <Sparkles className="h-4 w-4 text-violet-500" />
            <p className="text-[10px] font-black text-violet-500 tracking-[0.4em] uppercase">
              Exhibition Core
            </p>
          </div>
          <h1 className="text-4xl lg:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-zinc-900 to-zinc-500 dark:from-white dark:to-zinc-500 tracking-tighter">
            Atmosphere
          </h1>
        </div>

        {/* Master Power Switch */}
        <button
          onClick={() => setIsPowerOn(!isPowerOn)}
          className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 shadow-xl ${isPowerOn
            ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-violet-500/20 hover:scale-105'
            : 'bg-zinc-200 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 opacity-80'
            }`}
        >
          <Power className={`h-6 w-6 ${isPowerOn ? 'animate-pulse' : ''}`} />
          {isPowerOn && (
            <div className="absolute inset-0 rounded-full border-2 border-white/20 dark:border-zinc-900/20 animate-ping" />
          )}
        </button>
      </div>

      {/* Asymmetrical Bento Grid Layout */}
      <div className={`grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 flex-1 min-h-0 relative z-10 transition-all duration-700 ${!isPowerOn ? 'opacity-40 grayscale-[0.8] pointer-events-none' : ''}`}>

        {/* HERO WIDGET: Spatial Lighting Array (Col-span 7) */}
        <div className="lg:col-span-7 flex flex-col h-full bg-white/40 dark:bg-zinc-950/30 backdrop-blur-3xl border border-white/60 dark:border-zinc-800/50 rounded-[32px] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.5)] overflow-hidden transition-all duration-500 hover:shadow-2xl group min-h-0">
          <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-white/0 dark:from-white/5 dark:to-transparent pointer-events-none" />

          <div className="flex items-start justify-between mb-4 relative z-10">
            <div>
              <h3 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight mb-1">Spatial Lighting</h3>
              <p className="text-[11px] font-bold text-zinc-500 tracking-widest uppercase">Select an atmospheric preset</p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20">
              <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
              <span className="text-[9px] font-black text-violet-600 dark:text-violet-400 tracking-widest uppercase">Grid Active</span>
            </div>
          </div>

          {/* Honeycomb/Grid of Glowing Presets */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 flex-1 relative z-10 min-h-0">
            {lightingModes.map((mode) => {
              const isActive = activeLightingMode === mode;
              return (
                <div
                  key={mode}
                  onClick={() => setActiveLightingMode(mode)}
                  className={`group/btn relative flex flex-col items-center justify-center p-3 rounded-[20px] cursor-pointer transition-all duration-500 overflow-hidden border ${isActive
                    ? "bg-zinc-900 dark:bg-white border-transparent scale-[1.03]"
                    : "bg-white/50 dark:bg-zinc-900/50 border-white/40 dark:border-zinc-800/50 hover:bg-white dark:hover:bg-zinc-800 hover:scale-[1.02]"
                    }`}
                >
                  {/* Intense active background glow */}
                  {isActive && (
                    <div className={`absolute inset-0 opacity-20 dark:opacity-30 bg-gradient-to-br ${getLightingGlow(mode)} animate-pulse`} />
                  )}

                  {/* Floating Icon */}
                  <div className={`mb-4 transition-transform duration-500 ${isActive ? 'scale-110' : 'group-hover/btn:scale-110'}`}>
                    <div className={`p-4 rounded-full ${isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-zinc-500'}`}>
                      {/* We dynamically clone the icon with the right color class if active */}
                      {isActive ? (
                        <div className="relative">
                          {lightingIcons[mode]}
                          <div className={`absolute inset-0 blur-lg bg-gradient-to-tr ${getLightingGlow(mode)} -z-10`} />
                        </div>
                      ) : (
                        lightingIcons[mode]
                      )}
                    </div>
                  </div>

                  <span className={`text-sm font-black tracking-widest uppercase transition-colors ${isActive ? "text-white dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-400"}`}>
                    {mode}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN STACK */}
        <div className="lg:col-span-5 flex flex-col gap-3 lg:gap-4 h-full min-h-0">

          {/* TOP RIGHT: Acoustic Waveform Slider */}
          <div className="flex-1 flex flex-col bg-white/40 dark:bg-zinc-950/30 backdrop-blur-3xl border border-white/60 dark:border-zinc-800/50 rounded-[32px] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.5)] overflow-hidden transition-all duration-500 hover:shadow-2xl relative group min-h-0">
            <div className="flex items-start justify-between mb-2 relative z-10">
              <div>
                <h3 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight mb-1">Acoustics</h3>
                <p className="text-[11px] font-bold text-zinc-500 tracking-widest uppercase">Master Volume</p>
              </div>
              <span className="text-3xl lg:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-blue-400 to-cyan-600 tracking-tighter">
                {volume}<span className="text-xl text-blue-500/50">%</span>
              </span>
            </div>

            {/* Tactile Waveform Drag Area */}
            <div className="flex-1 flex flex-col justify-end relative z-10">
              <div
                className="w-full h-20 lg:h-24 relative cursor-ew-resize touch-none group/wave flex items-end justify-between gap-[2px]"
                onPointerDown={handleVolumePointerDown}
                onPointerMove={handleVolumePointerMove}
                onPointerUp={handleVolumePointerUp}
                onPointerCancel={handleVolumePointerUp}
              >
                {/* Drag instruction overlay */}
                <div className="absolute inset-x-0 -top-8 text-center opacity-0 group-hover/wave:opacity-100 transition-opacity duration-300">
                  <span className="text-[9px] font-black text-blue-500 tracking-widest uppercase bg-blue-500/10 px-3 py-1 rounded-full">Slide to adjust</span>
                </div>

                {waveform.map((h, i) => {
                  const isActive = (i / waveform.length) * 100 <= volume;
                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-full transition-all duration-150 ease-out ${isActive
                        ? 'bg-gradient-to-t from-blue-600 to-cyan-400 shadow-[0_0_10px_rgba(56,189,248,0.5)]'
                        : 'bg-zinc-200 dark:bg-zinc-800/50'
                        }`}
                      style={{
                        height: `${h}%`,
                        opacity: isActive ? 1 : 0.5,
                        transform: isActive && isVolumeDragging ? 'scaleY(1.1)' : 'scaleY(1)'
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* BOTTOM RIGHT: Circular Climate Dial */}
          <div className="flex-[1.5] flex flex-col items-center justify-center bg-white/40 dark:bg-zinc-950/30 backdrop-blur-3xl border border-white/60 dark:border-zinc-800/50 rounded-[32px] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.5)] overflow-hidden transition-all duration-500 hover:shadow-2xl relative group min-h-0">
            <div className={`absolute inset-0 bg-gradient-to-b ${getTempColor(temperature)} opacity-[0.03] pointer-events-none transition-colors duration-1000`} />

            <div className="absolute top-5 left-5 z-10">
              <h3 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight mb-0">Climate</h3>
              <p className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase">Zone 1 HVAC</p>
            </div>

            {/* LED Tick Ring & Radial Dial */}
            <div className="relative w-44 h-44 mt-4 lg:mt-8 flex items-center justify-center">

              {/* LED Ticks */}
              {Array.from({ length: 48 }).map((_, i) => {
                const rotation = i * 7.5; // 360 / 48
                // Map the 48 ticks to the temperature range 15 to 31 (span of 16).
                // So each degree is 3 ticks.
                const tickTemp = 15 + (i / 3);
                const isActive = tickTemp <= temperature;
                return (
                  <div key={i} className="absolute inset-0 pointer-events-none" style={{ transform: `rotate(${rotation}deg)` }}>
                    <div className={`w-[2px] h-3 mx-auto rounded-full transition-colors duration-500 ${isActive
                      ? (temperature > 24 ? 'bg-orange-500 shadow-[0_0_8px_#f97316]' : 'bg-cyan-500 shadow-[0_0_8px_#06b6d4]')
                      : 'bg-zinc-300/50 dark:bg-zinc-800/50'
                      }`} />
                  </div>
                );
              })}

              {/* Central Glowing Core */}
              <div className="relative w-32 h-32 rounded-full bg-white dark:bg-zinc-900 shadow-2xl flex flex-col items-center justify-center z-10 border border-white/40 dark:border-zinc-800/50">
                <div className={`absolute inset-3 rounded-full blur-xl opacity-30 transition-colors duration-1000 ${temperature > 24 ? 'bg-orange-500' : 'bg-cyan-500'} animate-pulse`} />

                <span className={`text-4xl lg:text-5xl font-black tracking-tighter ${temperature > 24 ? 'text-transparent bg-clip-text bg-gradient-to-b from-orange-400 to-red-600' : 'text-transparent bg-clip-text bg-gradient-to-b from-cyan-400 to-blue-600'} transition-colors duration-700 filter drop-shadow-lg relative z-10`}>
                  {temperature}°
                </span>
                <span className="text-[8px] lg:text-[9px] font-black text-zinc-400 tracking-widest uppercase mt-0.5 relative z-10">
                  Target Set
                </span>
              </div>
            </div>

            {/* Floating Adjusters */}
            <div className="absolute bottom-5 right-5 flex gap-2 z-10">
              <button
                onClick={() => setTemperature(Math.max(16, temperature - 1))}
                className="w-10 h-10 lg:w-12 lg:h-12 rounded-full flex items-center justify-center bg-white dark:bg-zinc-900 shadow-xl text-zinc-500 hover:text-cyan-500 hover:shadow-cyan-500/20 hover:-translate-y-1 active:translate-y-0 transition-all border border-white/40 dark:border-zinc-800/50"
              >
                <Wind className="h-4 w-4 lg:h-5 lg:w-5" />
              </button>
              <button
                onClick={() => setTemperature(Math.min(30, temperature + 1))}
                className="w-10 h-10 lg:w-12 lg:h-12 rounded-full flex items-center justify-center bg-white dark:bg-zinc-900 shadow-xl text-zinc-500 hover:text-orange-500 hover:shadow-orange-500/20 hover:-translate-y-1 active:translate-y-0 transition-all border border-white/40 dark:border-zinc-800/50"
              >
                <Flame className="h-5 w-5" />
              </button>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
