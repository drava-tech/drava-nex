"use client";

import React, { useState, useCallback } from "react";

// ─── Types & Constants ────────────────────────────────────────────────────────

interface ZoneState {
  on: boolean;
  brightness: number;
}

interface Scene {
  name: string;
  ceiling: number;
  wallA: number;
  wallB: number;
}

const SCENES: Scene[] = [
  { name: "Presentation", ceiling: 30, wallA: 100, wallB: 100 },
  { name: "Demo Mode", ceiling: 70, wallA: 70, wallB: 70 },
  { name: "Full Brightness", ceiling: 100, wallA: 100, wallB: 100 },
  { name: "Ambient", ceiling: 20, wallA: 40, wallB: 40 },
];

// ─── Reusable pointer-drag slider hook ────────────────────────────────────────

function useSlider(
  value: number,
  setValue: (v: number) => void,
  min = 0,
  max = 100,
) {
  const [dragging, setDragging] = useState(false);

  const pctFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return Math.round(min + (x / rect.width) * (max - min));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setValue(pctFromEvent(e));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) setValue(pctFromEvent(e));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };

  const pct = ((value - min) / (max - min)) * 100;

  return { dragging, pct, onPointerDown, onPointerMove, onPointerUp };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EnvironmentView() {
  // DALI zone states
  const [ceiling, setCeiling] = useState<ZoneState>({ on: true, brightness: 100 });
  const [wallA, setWallA] = useState<ZoneState>({ on: true, brightness: 100 });
  const [wallB, setWallB] = useState<ZoneState>({ on: true, brightness: 100 });

  // Active scene (null = manual / no scene)
  const [activeScene, setActiveScene] = useState<string | null>("Full Brightness");

  // Master brightness (derived display, sets all on drag)
  const masterBrightness = Math.round((ceiling.brightness + wallA.brightness + wallB.brightness) / 3);
  const allOn = ceiling.on && wallA.on && wallB.on;

  // Tunable white (independent)
  const [tunable, setTunable] = useState({ on: true, brightness: 80, colorTemp: 4000 });

  // ── Master actions ──────────────────────────────────────────────────────────

  const masterOn = useCallback(() => {
    setCeiling((s) => ({ ...s, on: true }));
    setWallA((s) => ({ ...s, on: true }));
    setWallB((s) => ({ ...s, on: true }));
  }, []);

  const masterOff = useCallback(() => {
    setCeiling((s) => ({ ...s, on: false }));
    setWallA((s) => ({ ...s, on: false }));
    setWallB((s) => ({ ...s, on: false }));
  }, []);

  const setMasterBrightness = useCallback((v: number) => {
    setCeiling((s) => ({ ...s, brightness: v, on: v > 0 }));
    setWallA((s) => ({ ...s, brightness: v, on: v > 0 }));
    setWallB((s) => ({ ...s, brightness: v, on: v > 0 }));
    setActiveScene(null);
  }, []);

  const applyScene = useCallback((scene: Scene) => {
    setCeiling({ on: true, brightness: scene.ceiling });
    setWallA({ on: true, brightness: scene.wallA });
    setWallB({ on: true, brightness: scene.wallB });
    setActiveScene(scene.name);
  }, []);

  // ── Slider instances ────────────────────────────────────────────────────────

  const masterSlider = useSlider(masterBrightness, setMasterBrightness);

  const ceilingSlider = useSlider(ceiling.brightness, (v) => {
    setCeiling((s) => ({ ...s, brightness: v }));
    setActiveScene(null);
  });
  const wallASlider = useSlider(wallA.brightness, (v) => {
    setWallA((s) => ({ ...s, brightness: v }));
    setActiveScene(null);
  });
  const wallBSlider = useSlider(wallB.brightness, (v) => {
    setWallB((s) => ({ ...s, brightness: v }));
    setActiveScene(null);
  });

  const tunableBrightnessSlider = useSlider(tunable.brightness, (v) =>
    setTunable((s) => ({ ...s, brightness: v })),
  );
  const tunableTempSlider = useSlider(
    tunable.colorTemp,
    (v) => setTunable((s) => ({ ...s, colorTemp: v })),
    2700,
    6500,
  );

  return (
    <div className="w-full h-full flex flex-col justify-between select-none py-2">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-400/30 shrink-0">
        <div>
          <h1 className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
            Lighting Control
          </h1>
          <p className="text-[11px] text-zinc-500 mt-1">
            DALI zone control, scene presets, and tunable white fixture management.
          </p>
        </div>
        {/* Master status indicator */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${allOn ? "bg-emerald-500" : "bg-zinc-400"}`} />
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {allOn ? "All Zones Active" : "Partial / Off"}
          </span>
        </div>
      </div>

      {/* Main 3-Column Grid */}
      <div className="grid grid-cols-3 gap-4 lg:gap-6 items-stretch flex-1 py-4 overflow-hidden min-h-0">

        {/* ─── Column 1: Master Control ──────────────────────────────────── */}
        <div className="bg-[#e6e6e6] dark:bg-zinc-900 border border-zinc-350 dark:border-zinc-850 rounded-2xl p-5 shadow-sm flex flex-col h-full min-h-0">
          {/* Title */}
          <div className="border border-zinc-400/50 dark:border-zinc-700/60 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wider uppercase text-zinc-800 dark:text-zinc-200 w-fit shrink-0">
            Master Control
          </div>

          {/* ON / OFF buttons */}
          <div className="flex items-center gap-3 mt-4 shrink-0">
            <button
              onClick={masterOn}
              className={`flex-1 py-2 rounded-xl font-bold text-sm flex items-center justify-center active:scale-95 transition-all shadow-sm ${
                allOn
                  ? "bg-zinc-800 dark:bg-zinc-150 text-white dark:text-zinc-900"
                  : "bg-zinc-300 hover:bg-zinc-350 dark:bg-zinc-800 dark:hover:bg-zinc-705 text-zinc-800 dark:text-white"
              }`}
            >
              ON
            </button>
            <button
              onClick={masterOff}
              className={`flex-1 py-2 rounded-xl font-bold text-sm flex items-center justify-center active:scale-95 transition-all shadow-sm ${
                !allOn
                  ? "bg-zinc-800 dark:bg-zinc-150 text-white dark:text-zinc-900"
                  : "bg-zinc-300 hover:bg-zinc-350 dark:bg-zinc-800 dark:hover:bg-zinc-705 text-zinc-800 dark:text-white"
              }`}
            >
              OFF
            </button>
          </div>

          {/* Scene Presets — vertical timeline */}
          <div className="relative pl-6 flex flex-col justify-between flex-1 py-4 min-h-0">
            {/* Vertical connector line */}
            <div className="absolute left-10 top-6 bottom-6 w-[2px] bg-zinc-400/60 dark:bg-zinc-700/60 -translate-x-1/2" />

            {SCENES.map((scene) => {
              const isActive = activeScene === scene.name;
              return (
                <div
                  key={scene.name}
                  onClick={() => applyScene(scene)}
                  className="flex items-center gap-4 group cursor-pointer relative z-10 py-1"
                >
                  {/* Radio Circle */}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 shadow-sm shrink-0 ${
                      isActive
                        ? "bg-zinc-800 dark:bg-zinc-150 ring-4 ring-zinc-350 dark:ring-zinc-700 scale-105"
                        : "bg-[#9a9a9a] group-hover:bg-zinc-650 dark:bg-zinc-800 dark:group-hover:bg-zinc-700"
                    }`}
                  >
                    {isActive && (
                      <div className="w-3 h-3 rounded-full bg-white dark:bg-zinc-900" />
                    )}
                  </div>

                  {/* Scene Label */}
                  <span
                    className={`text-sm font-bold transition-colors ${
                      isActive
                        ? "text-zinc-950 dark:text-white"
                        : "text-zinc-700 dark:text-zinc-400 group-hover:text-zinc-950 dark:group-hover:text-zinc-200"
                    }`}
                  >
                    {scene.name}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Master Brightness Slider */}
          <div className="shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">
                Master Brightness
              </span>
              <span className="text-sm font-black text-zinc-950 dark:text-white">
                {masterBrightness}%
              </span>
            </div>
            <div
              onPointerDown={masterSlider.onPointerDown}
              onPointerMove={masterSlider.onPointerMove}
              onPointerUp={masterSlider.onPointerUp}
              className="w-full h-8 bg-zinc-300 dark:bg-zinc-800 border border-zinc-400/40 dark:border-zinc-700/40 rounded-xl relative overflow-hidden flex items-center px-4 cursor-pointer touch-none"
            >
              <div
                className={`h-full bg-white dark:bg-zinc-150 absolute left-0 top-0 shadow-sm ${
                  masterSlider.dragging ? "" : "transition-all duration-150"
                }`}
                style={{ width: `${masterSlider.pct}%` }}
              />
              <span className="text-[9px] uppercase font-bold tracking-widest text-zinc-800 dark:text-zinc-300 mix-blend-difference relative z-10">
                Drag to adjust
              </span>
            </div>
          </div>
        </div>

        {/* ─── Column 2: DALI Zones ──────────────────────────────────────── */}
        <div className="bg-[#e6e6e6] dark:bg-zinc-900 border border-zinc-350 dark:border-zinc-850 rounded-2xl p-5 shadow-sm flex flex-col h-full min-h-0">
          {/* Title */}
          <div className="border border-zinc-400/50 dark:border-zinc-700/60 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wider uppercase text-zinc-800 dark:text-zinc-200 w-fit shrink-0">
            DALI Zones
          </div>

          {/* 3 zone sub-cards, equal height */}
          <div className="flex flex-col flex-1 gap-3 mt-4 min-h-0">
            {([
              { label: "Ceiling Lights", state: ceiling, setState: setCeiling, slider: ceilingSlider },
              { label: "Wall Lighting A", state: wallA, setState: setWallA, slider: wallASlider },
              { label: "Wall Lighting B", state: wallB, setState: setWallB, slider: wallBSlider },
            ] as const).map(({ label, state, setState, slider }) => (
              <div
                key={label}
                className="flex-1 bg-zinc-200/60 dark:bg-zinc-800/50 border border-zinc-350/50 dark:border-zinc-750/50 rounded-xl p-4 flex flex-col justify-between min-h-0"
              >
                {/* Zone header: name + status + toggle */}
                <div className="flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors ${
                        state.on ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-600"
                      }`}
                    />
                    <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      {label}
                    </span>
                  </div>
                  <button
                    onClick={() => setState((s) => ({ ...s, on: !s.on }))}
                    className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 ${
                      state.on
                        ? "bg-zinc-800 dark:bg-zinc-150 text-white dark:text-zinc-900"
                        : "bg-zinc-300 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {state.on ? "ON" : "OFF"}
                  </button>
                </div>

                {/* Brightness slider */}
                <div className="mt-auto pt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] uppercase font-bold tracking-widest text-zinc-500">
                      Brightness
                    </span>
                    <span className="text-xs font-black text-zinc-800 dark:text-zinc-200">
                      {state.brightness}%
                    </span>
                  </div>
                  <div
                    onPointerDown={slider.onPointerDown}
                    onPointerMove={slider.onPointerMove}
                    onPointerUp={slider.onPointerUp}
                    className={`w-full h-6 bg-zinc-300 dark:bg-zinc-800 border border-zinc-400/40 dark:border-zinc-700/40 rounded-lg relative overflow-hidden cursor-pointer touch-none ${
                      !state.on ? "opacity-40 pointer-events-none" : ""
                    }`}
                  >
                    <div
                      className={`h-full bg-white dark:bg-zinc-150 absolute left-0 top-0 shadow-sm ${
                        slider.dragging ? "" : "transition-all duration-150"
                      }`}
                      style={{ width: `${slider.pct}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Column 3: Tunable White Light ─────────────────────────────── */}
        <div className="bg-[#e6e6e6] dark:bg-zinc-900 border border-zinc-350 dark:border-zinc-850 rounded-2xl p-5 shadow-sm flex flex-col justify-between h-full min-h-0">
          {/* Title */}
          <div className="border border-zinc-400/50 dark:border-zinc-700/60 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wider uppercase text-zinc-800 dark:text-zinc-200 w-fit shrink-0">
            Tunable White
          </div>

          {/* ON / OFF toggle */}
          <div className="flex justify-center mt-4 shrink-0">
            <button
              onClick={() => setTunable((s) => ({ ...s, on: !s.on }))}
              className={`px-6 py-2 rounded-xl font-bold text-sm flex items-center gap-2 active:scale-95 transition-all shadow-sm ${
                tunable.on
                  ? "bg-zinc-800 dark:bg-zinc-150 text-white dark:text-zinc-900"
                  : "bg-zinc-300 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400"
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full ${
                  tunable.on ? "bg-emerald-400" : "bg-zinc-500"
                }`}
              />
              {tunable.on ? "ON" : "OFF"}
            </button>
          </div>

          {/* Brightness readout */}
          <div className={`flex flex-col items-center justify-center flex-1 py-4 transition-opacity ${
            !tunable.on ? "opacity-40" : ""
          }`}>
            <span className="text-6xl font-black text-zinc-950 dark:text-white tracking-tighter">
              {tunable.brightness}%
            </span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 mt-1">
              Brightness Level
            </span>
          </div>

          {/* Sliders */}
          <div className={`space-y-4 shrink-0 ${!tunable.on ? "opacity-40 pointer-events-none" : ""}`}>
            {/* Brightness slider */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">
                  Brightness
                </span>
                <span className="text-xs font-black text-zinc-800 dark:text-zinc-200">
                  {tunable.brightness}%
                </span>
              </div>
              <div
                onPointerDown={tunableBrightnessSlider.onPointerDown}
                onPointerMove={tunableBrightnessSlider.onPointerMove}
                onPointerUp={tunableBrightnessSlider.onPointerUp}
                className="w-full h-8 bg-zinc-300 dark:bg-zinc-800 border border-zinc-400/40 dark:border-zinc-700/40 rounded-xl relative overflow-hidden cursor-pointer touch-none"
              >
                <div
                  className={`h-full bg-white dark:bg-zinc-150 absolute left-0 top-0 shadow-sm ${
                    tunableBrightnessSlider.dragging ? "" : "transition-all duration-150"
                  }`}
                  style={{ width: `${tunableBrightnessSlider.pct}%` }}
                />
              </div>
            </div>

            {/* Color temperature slider */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">
                  Color Temperature
                </span>
                <span className="text-xs font-black text-zinc-800 dark:text-zinc-200">
                  {tunable.colorTemp}K
                </span>
              </div>
              <div
                onPointerDown={tunableTempSlider.onPointerDown}
                onPointerMove={tunableTempSlider.onPointerMove}
                onPointerUp={tunableTempSlider.onPointerUp}
                className="w-full h-8 rounded-xl relative overflow-hidden cursor-pointer touch-none border border-zinc-400/40 dark:border-zinc-700/40"
                style={{
                  background: "linear-gradient(to right, #ff9329, #fff5e6, #e0e8ff, #a8c4ff)",
                }}
              >
                {/* Position indicator */}
                <div
                  className={`absolute top-0 h-full w-1 bg-zinc-900 dark:bg-white shadow-lg ${
                    tunableTempSlider.dragging ? "" : "transition-all duration-150"
                  }`}
                  style={{ left: `${tunableTempSlider.pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[9px] font-bold text-zinc-500 tracking-wider">
                  Warm 2700K
                </span>
                <span className="text-[9px] font-bold text-zinc-500 tracking-wider">
                  Cool 6500K
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
