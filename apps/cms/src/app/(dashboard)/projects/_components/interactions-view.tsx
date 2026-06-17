"use client";

import React, { useState } from "react";
import { Hand, Sliders, Play, CircleAlert } from "lucide-react";

export function InteractionsView() {
  const [activeSubTab, setActiveSubTab] = useState<"gesture" | "touch">("gesture");
  const [sensitivity, setSensitivity] = useState(75);
  const [gestures, setGestures] = useState([
    { id: "swipe-left", name: "Swipe Left", action: "Next Project", enabled: true },
    { id: "swipe-right", name: "Swipe Right", action: "Previous Project", enabled: true },
    { id: "pinch", name: "Pinch Zoom", action: "Zoom Layout", enabled: false },
    { id: "wave", name: "Hand Wave", action: "Reset/Home Screen", enabled: true },
  ]);

  const [touchTriggers] = useState([
    { id: "single-tap", name: "Single Tap", action: "Open Project Details", feedback: "Haptic Tap" },
    { id: "double-tap", name: "Double Tap", action: "Like / Favorite Project", feedback: "Heart Animation" },
    { id: "long-press", name: "Long Press (2s)", action: "Enter Edit Mode", feedback: "Context Menu" },
  ]);

  const toggleGesture = (id: string) => {
    setGestures(gestures.map(g => g.id === id ? { ...g, enabled: !g.enabled } : g));
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Interactions Settings</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Configure gesture recognition and touch interface triggers.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-zinc-200 dark:border-zinc-800 pb-px">
        <button
          onClick={() => setActiveSubTab("gesture")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${
            activeSubTab === "gesture"
              ? "border-black text-black dark:border-white dark:text-white"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          Gesture Controls
        </button>
        <button
          onClick={() => setActiveSubTab("touch")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${
            activeSubTab === "touch"
              ? "border-black text-black dark:border-white dark:text-white"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          Touch Mapping
        </button>
      </div>

      {/* Content */}
      {activeSubTab === "gesture" ? (
        <div className="space-y-6">
          {/* General Configuration Card */}
          <div className="bg-[#f4f4f5] dark:bg-zinc-900 rounded-xl p-6 border border-zinc-200 dark:border-zinc-800">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
              <Sliders className="h-5 w-5" /> Sensitivity & Calibration
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-600 dark:text-zinc-300">Gesture Recognition Sensitivity</span>
                  <span className="font-semibold text-zinc-900 dark:text-white">{sensitivity}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                  className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-black dark:accent-white"
                />
              </div>
              <div className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <CircleAlert className="h-4 w-4 shrink-0 text-amber-500" />
                <span>Higher sensitivity increases responsiveness but may result in accidental triggers in busy environments.</span>
              </div>
            </div>
          </div>

          {/* Gesture List */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <Hand className="h-5 w-5" /> Available Gestures
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {gestures.map((gesture) => (
                <div
                  key={gesture.id}
                  className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-all"
                >
                  <div className="space-y-1">
                    <h4 className="font-medium text-zinc-900 dark:text-white">{gesture.name}</h4>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Action: <span className="font-semibold text-zinc-800 dark:text-zinc-200">{gesture.action}</span></p>
                  </div>
                  <button
                    onClick={() => toggleGesture(gesture.id)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      gesture.enabled ? "bg-black dark:bg-white" : "bg-zinc-200 dark:bg-zinc-800"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-black shadow ring-0 transition duration-200 ease-in-out ${
                        gesture.enabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-[#f4f4f5] dark:bg-zinc-900 rounded-xl p-6 border border-zinc-200 dark:border-zinc-800">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-2">Display Touch Overlay</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">Map interactive zones and actions for user touch inputs.</p>
            <div className="flex gap-3">
              <button className="flex items-center gap-2 px-4 py-2 bg-black text-white dark:bg-white dark:text-black rounded-lg text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors">
                <Play className="h-4 w-4 fill-current" /> Calibrate Touch Screen
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Touch Mappings</h3>
            <div className="overflow-hidden border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-950">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                    <th className="p-4">Input Trigger</th>
                    <th className="p-4">Assigned Action</th>
                    <th className="p-4">UX Feedback</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
                  {touchTriggers.map((trigger) => (
                    <tr key={trigger.id} className="hover:bg-zinc-50/55 dark:hover:bg-zinc-900/30">
                      <td className="p-4 font-medium text-zinc-900 dark:text-white">{trigger.name}</td>
                      <td className="p-4 text-zinc-700 dark:text-zinc-300">{trigger.action}</td>
                      <td className="p-4 text-zinc-500 dark:text-zinc-400">
                        <span className="inline-flex items-center rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                          {trigger.feedback}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
