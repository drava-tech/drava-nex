"use client";

import React, { useState } from "react";

export function EnvironmentView() {
  // Lighting Mode State
  const [activeLightingMode, setActiveLightingMode] = useState("Interactive");
  const lightingModes = [
    "Interactive",
    "Custom",
    "Preset 01",
    "Preset 02",
    "Preset 03",
    "Preset 04",
    "Preset 05",
  ];

  // Speaker Volume State (0 to 100)
  const [volume, setVolume] = useState(50);

  // Temperature State (16 to 30) with padded boundary numbers (15 and 31) for centering alignment
  const [temperature, setTemperature] = useState(21);
  const temps = Array.from({ length: 17 }, (_, i) => i + 15); // 15 to 31

  const [isVolumeDragging, setIsVolumeDragging] = useState(false);

  const updateVolumeFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.min(100, Math.max(0, Math.round((x / rect.width) * 100)));
    setVolume(pct);
  };

  const handleVolumePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsVolumeDragging(true);
    updateVolumeFromEvent(e);
  };

  const handleVolumePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isVolumeDragging) {
      updateVolumeFromEvent(e);
    }
  };

  const handleVolumePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsVolumeDragging(false);
  };

  return (
    <div className="w-full h-full flex flex-col justify-between select-none py-2">
      {/* Header - Fixed height */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-400/30 shrink-0">
        <div>
          <h1 className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
            Environment
          </h1>
          <p className="text-[11px] text-zinc-500 mt-1">
            Configure exhibition lighting presets, room temperature, and spatial audio levels.
          </p>
        </div>
      </div>

      {/* Main 3-Column Grid - Fits perfectly without scrolling */}
      <div className="grid grid-cols-3 gap-6 items-stretch flex-1 py-4 overflow-hidden min-h-0">
        {/* Column 1: Lighting Mode */}
        <div className="bg-[#e6e6e6] dark:bg-zinc-900 border border-zinc-350 dark:border-zinc-850 rounded-2xl p-5 shadow-sm flex flex-col justify-between h-full min-h-0">
          {/* Title Box */}
          <div className="border border-zinc-400/50 dark:border-zinc-700/60 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wider uppercase text-zinc-800 dark:text-zinc-200 w-fit shrink-0">
            Lighting Mode
          </div>

          {/* Vertical Timeline Picker - flexible size */}
          <div className="relative pl-6 flex flex-col justify-between flex-1 py-4 min-h-0">
            {/* Vertical connector line */}
            <div className="absolute left-10 top-8 bottom-8 w-[2px] bg-zinc-400/60 dark:bg-zinc-700/60 -translate-x-1/2" />

            {lightingModes.map((mode) => {
              const isActive = activeLightingMode === mode;
              return (
                <div
                  key={mode}
                  onClick={() => setActiveLightingMode(mode)}
                  className="flex items-center gap-4 group cursor-pointer relative z-10 py-1"
                >
                  {/* Radio Circle */}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 shadow-sm ${isActive
                      ? "bg-zinc-800 dark:bg-zinc-150 ring-4 ring-zinc-350 dark:ring-zinc-700 scale-105"
                      : "bg-[#9a9a9a] group-hover:bg-zinc-650 dark:bg-zinc-800 dark:group-hover:bg-zinc-700"
                      }`}
                  >
                    {isActive && (
                      <div className="w-3 h-3 rounded-full bg-white dark:bg-zinc-900" />
                    )}
                  </div>

                  {/* Mode Label */}
                  <span
                    className={`text-sm font-bold transition-colors ${isActive
                      ? "text-zinc-950 dark:text-white"
                      : "text-zinc-700 dark:text-zinc-400 group-hover:text-zinc-950 dark:group-hover:text-zinc-200"
                      }`}
                  >
                    {mode}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 2: Speaker Volume (Horizontal Slider style) */}
        <div className="bg-[#e6e6e6] dark:bg-zinc-900 border border-zinc-350 dark:border-zinc-850 rounded-2xl p-5 shadow-sm flex flex-col justify-between h-full min-h-0">
          {/* Title Box */}
          <div className="border border-zinc-400/50 dark:border-zinc-700/60 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wider uppercase text-zinc-800 dark:text-zinc-200 w-fit shrink-0">
            Speaker Volume
          </div>

          {/* Large Volume Readout in the middle */}
          <div className="flex flex-col items-center justify-center flex-1 py-4">
            <span className="text-6xl font-black text-zinc-950 dark:text-white tracking-tighter">
              {volume}%
            </span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 mt-1">
              Active Gain Level
            </span>
          </div>

          {/* Horizontal Slider Area */}
          <div className="space-y-4 shrink-0">
            {/* Interactive horizontal volume track */}
            <div
              onPointerDown={handleVolumePointerDown}
              onPointerMove={handleVolumePointerMove}
              onPointerUp={handleVolumePointerUp}
              className="w-full h-8 bg-zinc-300 dark:bg-zinc-800 border border-zinc-400/40 dark:border-zinc-700/40 rounded-xl relative overflow-hidden flex items-center px-4 cursor-pointer touch-none"
            >
              {/* Filled progress bar */}
              <div
                className="h-full bg-white dark:bg-zinc-150 absolute left-0 top-0 transition-all duration-150 shadow-sm"
                style={{ width: `${volume}%` }}
              />
              <span className="text-[9px] uppercase font-bold tracking-widest text-zinc-800 dark:text-zinc-300 mix-blend-difference relative z-10">
                Drag or click to adjust volume
              </span>
            </div>

            {/* Incremental Adjusters */}
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => setVolume(Math.max(0, volume - 5))}
                className="flex-1 py-2 rounded-xl bg-zinc-300 hover:bg-zinc-350 dark:bg-zinc-800 dark:hover:bg-zinc-705 text-zinc-800 dark:text-white font-bold flex items-center justify-center active:scale-95 transition-all text-lg shadow-sm"
              >
                -
              </button>
              <button
                onClick={() => setVolume(Math.min(100, volume + 5))}
                className="flex-1 py-2 rounded-xl bg-zinc-300 hover:bg-zinc-350 dark:bg-zinc-800 dark:hover:bg-zinc-705 text-zinc-800 dark:text-white font-bold flex items-center justify-center active:scale-95 transition-all text-lg shadow-sm"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Column 3: Temperature Control */}
        <div className="bg-[#e6e6e6] dark:bg-zinc-900 border border-zinc-350 dark:border-zinc-850 rounded-2xl p-5 shadow-sm flex flex-col justify-between h-full min-h-0">
          {/* Title Box */}
          <div className="border border-zinc-400/50 dark:border-zinc-700/60 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wider uppercase text-zinc-800 dark:text-zinc-200 w-fit shrink-0">
            Temperature Control
          </div>

          {/* Mechanical Wheel Slide Display */}
          <div className="flex flex-col items-center justify-center flex-1 py-4">
            {/* Sliding container with mask */}
            <div className="w-[180px] h-16 overflow-hidden relative border border-zinc-350 dark:border-zinc-800 rounded-2xl bg-[#dfdfdf] dark:bg-zinc-950 flex items-center shadow-inner">
              {/* Fade out shadows at left and right */}
              <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#dfdfdf] dark:from-zinc-950 to-transparent z-10 pointer-events-none" />
              <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#dfdfdf] dark:from-zinc-950 to-transparent z-10 pointer-events-none" />

              {/* Slider Track */}
              <div
                className="flex transition-transform duration-500 ease-out"
                style={{
                  transform: `translateX(-${(temps.indexOf(temperature) - 1) * 60}px)`,
                }}
              >
                {temps.map((temp) => {
                  const isActive = temp === temperature;
                  const isBoundary = temp === 15 || temp === 31;
                  return (
                    <div
                      key={temp}
                      onClick={() => {
                        if (!isBoundary) setTemperature(temp);
                      }}
                      className={`w-[60px] shrink-0 flex items-center justify-center ${isBoundary ? "pointer-events-none" : "cursor-pointer"}`}
                    >
                      <span
                        className={`transition-all duration-300 font-black ${isActive
                          ? "text-4xl text-zinc-950 dark:text-white scale-110"
                          : "text-lg text-zinc-400 dark:text-zinc-650"
                          }`}
                      >
                        {isBoundary ? "" : `${temp}°`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 mt-3">
              Room Climate Setpoint
            </span>
          </div>

          {/* Adjusters & Axis Ticks */}
          <div className="space-y-4 shrink-0">
            {/* Horizontal Axis Scale Indicator */}
            <div className="w-full max-w-[240px] mx-auto flex flex-col gap-1 relative">
              {/* Scale Axis Line */}
              <div className="w-full h-[2px] bg-zinc-400/70 dark:bg-zinc-750" />

              {/* Ticks */}
              <div className="flex justify-between items-start px-2 relative -top-[5px] h-3">
                {/* Left tick */}
                <div
                  onClick={() => setTemperature(Math.max(16, temperature - 1))}
                  className="w-[1.5px] h-2.5 bg-zinc-800 dark:bg-zinc-400 cursor-pointer hover:scale-125 transition-all"
                />
                {/* Quarter tick */}
                <div className="w-[1px] h-1 bg-zinc-400 dark:bg-zinc-600" />
                {/* Middle tick (large active indicator) */}
                <div className="w-[2px] h-4.5 bg-zinc-950 dark:bg-white relative -top-0.5 shadow-sm" />
                {/* Three-quarter tick */}
                <div className="w-[1px] h-1 bg-zinc-400 dark:bg-zinc-600" />
                {/* Right tick */}
                <div
                  onClick={() => setTemperature(Math.min(30, temperature + 1))}
                  className="w-[1.5px] h-2.5 bg-zinc-800 dark:bg-zinc-400 cursor-pointer hover:scale-125 transition-all"
                />
              </div>
            </div>

            {/* Incremental Adjusters */}
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => setTemperature(Math.max(16, temperature - 1))}
                className="flex-1 py-2 rounded-xl bg-zinc-300 hover:bg-zinc-350 dark:bg-zinc-800 dark:hover:bg-zinc-705 text-zinc-800 dark:text-white font-bold flex items-center justify-center active:scale-95 transition-all text-lg shadow-sm"
              >
                -
              </button>
              <button
                onClick={() => setTemperature(Math.min(30, temperature + 1))}
                className="flex-1 py-2 rounded-xl bg-zinc-300 hover:bg-zinc-350 dark:bg-zinc-800 dark:hover:bg-zinc-705 text-zinc-800 dark:text-white font-bold flex items-center justify-center active:scale-95 transition-all text-lg shadow-sm"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
