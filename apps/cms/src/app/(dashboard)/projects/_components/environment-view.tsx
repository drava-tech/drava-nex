"use client";

import React, { useState } from "react";
import { Monitor, Volume2, KeyRound, Save } from "lucide-react";

export function EnvironmentView() {
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [volume, setVolume] = useState(80);
  const [envVars, setEnvVars] = useState([
    { key: "API_GATEWAY_URL", value: "https://api.interactive-cms.internal/v1" },
    { key: "DISPLAY_RESOLUTION", value: "3840x2160" },
    { key: "IDLE_TIMEOUT_MS", value: "180000" },
    { key: "HARDWARE_ACCELERATION", value: "true" },
  ]);

  const updateEnvValue = (key: string, value: string) => {
    setEnvVars(envVars.map(v => v.key === key ? { ...v, value } : v));
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Environment Configuration</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Manage display orientation, global hardware profiles, and environment variables.</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-black text-white dark:bg-white dark:text-black rounded-lg text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors">
          <Save className="h-4 w-4" /> Save Changes
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Physical Display Setup */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-6">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
            <Monitor className="h-5 w-5" /> Display & Sound Settings
          </h3>

          {/* Orientation */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Screen Orientation</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setOrientation("landscape")}
                className={`p-4 border rounded-xl flex flex-col items-center gap-2 transition-all ${
                  orientation === "landscape"
                    ? "border-black bg-zinc-50 dark:border-white dark:bg-zinc-800 text-zinc-900 dark:text-white font-medium"
                    : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                }`}
              >
                <div className="w-12 h-8 border-2 border-current rounded-md flex items-center justify-center opacity-80">
                  <span className="text-[10px] uppercase font-bold">16:9</span>
                </div>
                <span>Landscape (Horizontal)</span>
              </button>
              <button
                onClick={() => setOrientation("portrait")}
                className={`p-4 border rounded-xl flex flex-col items-center gap-2 transition-all ${
                  orientation === "portrait"
                    ? "border-black bg-zinc-50 dark:border-white dark:bg-zinc-800 text-zinc-900 dark:text-white font-medium"
                    : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                }`}
              >
                <div className="w-8 h-12 border-2 border-current rounded-md flex items-center justify-center opacity-80">
                  <span className="text-[10px] uppercase font-bold rotate-90">9:16</span>
                </div>
                <span>Portrait (Vertical)</span>
              </button>
            </div>
          </div>

          {/* Audio volume */}
          <div className="space-y-3">
            <div className="flex justify-between text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
              <span>Default Audio Volume</span>
              <span>{volume}%</span>
            </div>
            <div className="flex items-center gap-4">
              <Volume2 className="h-5 w-5 text-zinc-500" />
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-black dark:accent-white"
              />
            </div>
          </div>
        </div>

        {/* Environment Variables */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Environment Variables
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Define runtime settings injected into the local exhibition hardware.</p>

          <div className="space-y-4 pt-2">
            {envVars.map((env) => (
              <div key={env.key} className="space-y-1">
                <label className="text-xs font-mono font-semibold text-zinc-600 dark:text-zinc-400">{env.key}</label>
                <input
                  type="text"
                  value={env.value}
                  onChange={(e) => updateEnvValue(env.key, e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm bg-transparent text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
