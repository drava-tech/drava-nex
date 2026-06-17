"use client";

import React from "react";

interface ExperienceCenterConsoleProps {
  triggerBlockAction: (name: string) => void;
}

export function ExperienceCenterConsole({ triggerBlockAction }: ExperienceCenterConsoleProps) {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 select-none h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-zinc-400/30">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
          Experience Center
        </h1>
      </div>

      {/* Two-Column Grid (Build and Technology) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 relative flex-1 min-h-0 py-2">
        {/* Vertical Divider line */}
        <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-[1px] bg-zinc-400/40 -translate-x-1/2" />

        {/* Left Column: Build */}
        <div className="flex flex-col gap-6">
          <h2 className="text-2xl font-normal text-zinc-900 dark:text-zinc-100 text-center pb-2">
            Build
          </h2>

          <div className="flex flex-col gap-3">
            {/* Build Row 1 */}
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-1 flex flex-col gap-2">
                <button
                  onClick={() => triggerBlockAction("Concept Design")}
                  className="flex-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-800 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[46px] active:scale-95 transition-all shadow-sm"
                />
                <button
                  onClick={() => triggerBlockAction("Schematic Flow")}
                  className="flex-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-800 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[46px] active:scale-95 transition-all shadow-sm"
                />
              </div>
              <button
                onClick={() => triggerBlockAction("Lego Kits Integration")}
                className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("Floor Layout Blueprint")}
                className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
            </div>

            {/* Build Row 2 */}
            <div className="grid grid-cols-4 gap-3">
              <button
                onClick={() => triggerBlockAction("Structural Integrity Model")}
                className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("Assembly Line Simulation")}
                className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("EHS Safety Protocols")}
                className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
            </div>

            {/* Build Row 3 */}
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-1 flex flex-col gap-2">
                <button
                  onClick={() => triggerBlockAction("Electrical Routing Map")}
                  className="flex-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[46px] active:scale-95 transition-all shadow-sm"
                />
                <button
                  onClick={() => triggerBlockAction("HVAC Circulation Loop")}
                  className="flex-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[46px] active:scale-95 transition-all shadow-sm"
                />
              </div>
              <button
                onClick={() => triggerBlockAction("Digital Twin Sync Panel")}
                className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("Human Aping Diagnostics")}
                className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
            </div>

            {/* Build Row 4 */}
            <div className="grid grid-cols-4 gap-3">
              <button
                onClick={() => triggerBlockAction("Object Detection Node")}
                className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("Exhibition Playback Controller")}
                className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("Lobby Screen A Manager")}
                className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
            </div>
          </div>
        </div>

        {/* Right Column: Technology */}
        <div className="flex flex-col gap-6">
          <h2 className="text-2xl font-normal text-zinc-900 dark:text-zinc-100 text-center pb-2">
            Technology
          </h2>

          <div className="flex flex-col gap-3">
            {/* Tech Row 1 */}
            <div className="grid grid-cols-5 gap-3">
              <button
                onClick={() => triggerBlockAction("IoT Gateway Nodes")}
                className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("Sensor Telemetry Stream")}
                className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("Cloud Broker")}
                className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
            </div>

            {/* Tech Row 2 */}
            <div className="grid grid-cols-5 gap-3">
              <button
                onClick={() => triggerBlockAction("MQTT Bridge")}
                className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("Edge Analytics Processor")}
                className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <div className="col-span-2 flex flex-col gap-2">
                <button
                  onClick={() => triggerBlockAction("Node-Red Orchestrator")}
                  className="flex-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[46px] active:scale-95 transition-all shadow-sm"
                />
                <button
                  onClick={() => triggerBlockAction("Modbus Serial Sync")}
                  className="flex-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[46px] active:scale-95 transition-all shadow-sm"
                />
              </div>
            </div>

            {/* Tech Row 3 */}
            <div className="grid grid-cols-5 gap-3">
              <button
                onClick={() => triggerBlockAction("BACnet Router")}
                className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("SCADA Dashboard Host")}
                className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("D1 Persistence Database")}
                className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
            </div>

            {/* Tech Row 4 */}
            <div className="grid grid-cols-5 gap-3">
              <button
                onClick={() => triggerBlockAction("Wrangler Dev Server")}
                className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("Durable Objects Coordinator")}
                className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
              <button
                onClick={() => triggerBlockAction("Workers AI Classifier")}
                className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
