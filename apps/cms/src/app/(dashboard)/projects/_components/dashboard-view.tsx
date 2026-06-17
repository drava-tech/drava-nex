"use client";

import React from "react";
import { Activity, Cpu, Clock, Terminal, ShieldCheck } from "lucide-react";

export function DashboardView() {
  const stats = [
    { name: "Active Playback Devices", value: "14 / 16", change: "+2 today", icon: Activity, color: "text-emerald-500" },
    { name: "System CPU Load", value: "32.4%", change: "Optimal", icon: Cpu, color: "text-blue-500" },
    { name: "Average Session Time", value: "18m 45s", change: "+4% vs last week", icon: Clock, color: "text-amber-500" },
    { name: "Security Auditing", value: "Passed", change: "100% Secure", icon: ShieldCheck, color: "text-indigo-500" },
  ];

  const logs = [
    { id: 1, time: "18:24:12", device: "Lobby Screen A", event: "Project 'The White Tusker' preloaded successfully", type: "info" },
    { id: 2, time: "18:20:05", device: "Main Exhibit 3D", event: "Touch overlay recalibrated", type: "success" },
    { id: 3, time: "18:02:40", device: "Entrance Interactive", event: "Guest switched view to 'Human Aping'", type: "info" },
    { id: 4, time: "17:55:18", device: "Lobby Screen B", event: "Offline state detected, reconnected in 120ms", type: "warning" },
  ];

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Performance Dashboard</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Real-time status of displays, playback media, and interaction metrics.</p>
        </div>
      </div>

      {/* Grid Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.name} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-2">
              <div className="flex justify-between items-start">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{stat.name}</span>
                <Icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold text-zinc-900 dark:text-white">{stat.value}</span>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{stat.change}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts / Activity Visualizer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm lg:col-span-2">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white mb-4">Hourly Interactions Traffic</h3>
          <div className="h-48 flex items-end justify-between gap-2 pt-4">
            {[24, 45, 30, 60, 75, 50, 90, 85, 40, 65, 80, 95].map((val, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-2">
                <div
                  style={{ height: `${val}%` }}
                  className="w-full bg-zinc-800 dark:bg-zinc-200 hover:bg-black dark:hover:bg-white rounded-t transition-all duration-300"
                />
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{idx + 8}h</span>
              </div>
            ))}
          </div>
        </div>

        {/* System Health */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">Active Content Health</h3>
          <div className="space-y-3">
            {[
              { label: "High-Res Video Decoding", pct: 92 },
              { label: "3D Rendering Pipeline", pct: 88 },
              { label: "Memory Buffer Utilization", pct: 54 },
            ].map((item) => (
              <div key={item.label} className="space-y-1">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-600 dark:text-zinc-300">{item.label}</span>
                  <span className="text-zinc-900 dark:text-white">{item.pct}%</span>
                </div>
                <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5">
                  <div
                    style={{ width: `${item.pct}%` }}
                    className="bg-black dark:bg-white h-1.5 rounded-full"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Terminal log stream */}
      <div className="bg-zinc-950 text-zinc-300 rounded-xl border border-zinc-800 p-5 font-mono text-xs shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2 text-zinc-400">
          <span className="flex items-center gap-2"><Terminal className="h-4 w-4" /> LIVE SYSTEM LOGS</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-emerald-500 rounded-full animate-pulse" /> connected</span>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {logs.map((log) => (
            <div key={log.id} className="flex gap-4">
              <span className="text-zinc-500 select-none">{log.time}</span>
              <span className="text-zinc-400 font-semibold select-none">[{log.device}]</span>
              <span className={log.type === "warning" ? "text-amber-400" : log.type === "success" ? "text-emerald-400" : "text-zinc-200"}>
                {log.event}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
