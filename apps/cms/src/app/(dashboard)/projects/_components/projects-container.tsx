"use client";

import React, { useState } from "react";
import { ArrowLeft, Play, X } from "lucide-react";

const subProjects = [
  { id: 1, title: "The White Tusker PORT-FOLIO" },
  { id: 2, title: "Gamified Explainer Story" },
  { id: 3, title: "Human Aping" },
  { id: 4, title: "Analytics Dashboard (Digital Twin)" },
  { id: 5, title: "Object Recognition" },
  { id: 6, title: "Lego Kits" },
  { id: 7, title: "Assembly Simulator" },
  { id: 8, title: "EHS Training" },
];

const verticals = [
  { 
    id: "experience-center", 
    title: "Experience Center",
    videoUrl: "/experience_intro.mp4" 
  },
  { 
    id: "architecture-interiors", 
    title: "Architecture & Interiors",
    videoUrl: "/tusker_presentation.mov" 
  },
  { 
    id: "brand-solutions", 
    title: "Brand Solutions",
    videoUrl: "/brand_solutions_loop.webm" 
  },
];

interface ProjectsContainerProps {
  user: {
    name: string;
    role?: string;
    email?: string;
  };
  projectId: string;
}

export function ProjectsContainer({ user: _user, projectId: _projectId }: ProjectsContainerProps) {
  const [selectedSubProjectId, setSelectedSubProjectId] = useState<number | null>(null);
  const [showExperienceCenterDashboard, setShowExperienceCenterDashboard] = useState(false);
  const [activeVideo, setActiveVideo] = useState<string | null>(null);
  const [activeNotification, setActiveNotification] = useState<string | null>(null);

  const triggerBlockAction = (name: string) => {
    setActiveNotification(`Command executed: Loaded '${name}' configuration.`);
    setTimeout(() => {
      setActiveNotification(null);
    }, 3000);
  };

  const renderActiveView = () => {
    // 3. Level 3: Build & Technology console layout
    if (selectedSubProjectId === 1 && showExperienceCenterDashboard) {
      return (
        <div className="flex-1 w-full flex flex-col gap-6 select-none bg-[#e1e1e1] dark:bg-zinc-950 p-6 md:p-8 rounded-3xl border border-zinc-350 dark:border-zinc-800 shadow-xl">
          {/* Header with back button */}
          <div className="flex items-center justify-between pb-4 border-b border-zinc-400/30">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowExperienceCenterDashboard(false)}
                className="p-2.5 bg-[#d6d6d6] hover:bg-[#c8c8c8] dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl transition-all shadow-sm flex items-center justify-center"
                title="Back to Intermediate Screen"
              >
                <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
              </button>
              <h1 className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
                Experience Center
              </h1>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-zinc-650 dark:text-zinc-405">
                Live Signage Console
              </span>
            </div>
          </div>

          {/* Two-Column Grid (Build and Technology) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 relative flex-1 min-h-0 py-2">
            
            {/* Vertical Divider line */}
            <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-[1px] bg-zinc-400/40 -translate-x-1/2" />

            {/* Left Column: Build */}
            <div className="flex flex-col gap-6">
              <h2 className="text-base font-extrabold text-zinc-800 dark:text-zinc-300 text-center uppercase tracking-widest pb-1">
                Build
              </h2>

              <div className="flex flex-col gap-3">
                {/* Build Row 1 */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1 flex flex-col gap-2">
                    <button 
                      onClick={() => triggerBlockAction("Concept Design")}
                      className="flex-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[46px] active:scale-95 transition-all shadow-sm"
                    >
                      Concept Design
                    </button>
                    <button 
                      onClick={() => triggerBlockAction("Schematic Flow")}
                      className="flex-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[46px] active:scale-95 transition-all shadow-sm"
                    >
                      Schematic Flow
                    </button>
                  </div>
                  <button 
                    onClick={() => triggerBlockAction("Lego Kits Integration")}
                    className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Lego Kits Integration
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("Floor Layout Blueprint")}
                    className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Floor Layout
                  </button>
                </div>

                {/* Build Row 2 */}
                <div className="grid grid-cols-4 gap-3">
                  <button 
                    onClick={() => triggerBlockAction("Structural Integrity Model")}
                    className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Structural Model
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("Assembly Line Simulation")}
                    className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Assembly Line Simulation
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("EHS Safety Protocols")}
                    className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    EHS Safety
                  </button>
                </div>

                {/* Build Row 3 */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1 flex flex-col gap-2">
                    <button 
                      onClick={() => triggerBlockAction("Electrical Routing Map")}
                      className="flex-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[46px] active:scale-95 transition-all shadow-sm"
                    >
                      Electrical Map
                    </button>
                    <button 
                      onClick={() => triggerBlockAction("HVAC Circulation Loop")}
                      className="flex-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[46px] active:scale-95 transition-all shadow-sm"
                    >
                      HVAC Loop
                    </button>
                  </div>
                  <button 
                    onClick={() => triggerBlockAction("Digital Twin Sync Panel")}
                    className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Digital Twin Sync
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("Human Aping Diagnostics")}
                    className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Human Aping
                  </button>
                </div>

                {/* Build Row 4 */}
                <div className="grid grid-cols-4 gap-3">
                  <button 
                    onClick={() => triggerBlockAction("Object Detection Node")}
                    className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Object Detection
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("Exhibition Playback Controller")}
                    className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Playback Controller
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("Lobby Screen A Manager")}
                    className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Lobby Screen
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column: Technology */}
            <div className="flex flex-col gap-6">
              <h2 className="text-base font-extrabold text-zinc-800 dark:text-zinc-300 text-center uppercase tracking-widest pb-1">
                Technology
              </h2>

              <div className="flex flex-col gap-3">
                {/* Tech Row 1 */}
                <div className="grid grid-cols-5 gap-3">
                  <button 
                    onClick={() => triggerBlockAction("IoT Gateway Nodes")}
                    className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    IoT Gateway
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("Sensor Telemetry Stream")}
                    className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Telemetry Stream
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("Cloud Broker")}
                    className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Cloud
                  </button>
                </div>

                {/* Tech Row 2 */}
                <div className="grid grid-cols-5 gap-3">
                  <button 
                    onClick={() => triggerBlockAction("MQTT Bridge")}
                    className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    MQTT
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("Edge Analytics Processor")}
                    className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Edge Analytics
                  </button>
                  <div className="col-span-2 flex flex-col gap-2">
                    <button 
                      onClick={() => triggerBlockAction("Node-Red Orchestrator")}
                      className="flex-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[46px] active:scale-95 transition-all shadow-sm"
                    >
                      Node-Red
                    </button>
                    <button 
                      onClick={() => triggerBlockAction("Modbus Serial Sync")}
                      className="flex-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[46px] active:scale-95 transition-all shadow-sm"
                    >
                      Modbus Serial
                    </button>
                  </div>
                </div>

                {/* Tech Row 3 */}
                <div className="grid grid-cols-5 gap-3">
                  <button 
                    onClick={() => triggerBlockAction("BACnet Router")}
                    className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    BACnet Router
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("SCADA Dashboard Host")}
                    className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    SCADA Host
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("D1 Persistence Database")}
                    className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    D1 DB
                  </button>
                </div>

                {/* Tech Row 4 */}
                <div className="grid grid-cols-5 gap-3">
                  <button 
                    onClick={() => triggerBlockAction("Wrangler Dev Server")}
                    className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Wrangler
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("Durable Objects Coordinator")}
                    className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Durable Objects
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("Workers AI Classifier")}
                    className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-850 hover:bg-zinc-700 dark:hover:bg-zinc-705 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[100px] active:scale-95 transition-all shadow-sm"
                  >
                    Workers AI
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // 2. Level 2: Intermediate Verticals Grid
    if (selectedSubProjectId === 1 && !showExperienceCenterDashboard) {
      return (
        <div className="flex-1 w-full flex flex-col gap-6 select-none bg-[#e1e1e1] dark:bg-zinc-950 p-6 md:p-8 rounded-3xl border border-zinc-350 dark:border-zinc-800 shadow-xl">
          {/* Header with back to sub-projects grid button */}
          <div className="flex items-center justify-between pb-4 border-b border-zinc-400/30">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
                  The White Tusker PORT-FOLIO
                </h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  Select a vertical category below to configure signage feeds.
                </p>
              </div>
            </div>
          </div>

          {/* Three verticals grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 w-full py-2">
            {verticals.map((vertical) => (
              <div
                key={vertical.id}
                className="bg-[#d6d6d6] dark:bg-zinc-900 border border-zinc-350 dark:border-zinc-800/80 rounded-2xl p-6 flex flex-col gap-6 shadow-sm h-full"
              >
                {/* Title Section */}
                <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 tracking-tight leading-tight">
                  {vertical.title}
                </h3>

                {/* Gray Box */}
                <div 
                  onClick={() => {
                    if (vertical.id === "experience-center") {
                      setShowExperienceCenterDashboard(true);
                    } else {
                      setActiveVideo(vertical.videoUrl);
                    }
                  }}
                  className="flex-1 min-h-[160px] bg-white/40 dark:bg-zinc-800/50 rounded-xl border border-zinc-350/40 dark:border-zinc-700/20 cursor-pointer group relative overflow-hidden flex items-center justify-center transition-all duration-300 hover:bg-white/60 dark:hover:bg-zinc-850"
                >
                  <div className="w-12 h-12 rounded-full bg-white/90 dark:bg-zinc-900/90 flex items-center justify-center shadow-md transition-transform duration-300 group-hover:scale-110">
                    <Play className="h-5 w-5 text-zinc-800 dark:text-zinc-200 fill-zinc-800 dark:fill-zinc-200 ml-0.5" />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-2">
                  <button 
                    onClick={() => setActiveVideo(vertical.videoUrl)}
                    className="w-full py-2.5 bg-[#8a8a8a] hover:bg-[#7a7a7a] dark:bg-zinc-850 dark:hover:bg-zinc-850/80 text-white rounded-full text-xs font-semibold transition-all duration-205 shadow-sm text-center"
                  >
                    Watch Video
                  </button>
                  <button 
                    onClick={() => {
                      if (vertical.id === "experience-center") {
                        setShowExperienceCenterDashboard(true);
                      } else {
                        triggerBlockAction(vertical.title);
                      }
                    }}
                    className="w-full py-2.5 bg-black hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 text-white rounded-full text-xs font-semibold transition-all duration-200 shadow-sm text-center"
                  >
                    Projects
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (selectedSubProjectId !== null) {
      // Placeholder details for projects 2-8
      const selectedProj = subProjects.find(p => p.id === selectedSubProjectId);
      return (
        <div className="flex-1 w-full bg-[#e1e1e1] dark:bg-zinc-950 p-6 md:p-8 rounded-3xl border border-zinc-350 dark:border-zinc-800 shadow-xl flex flex-col gap-6">
          <div className="flex items-center gap-3 pb-4 border-b border-zinc-400/30">
            <button
              onClick={() => setSelectedSubProjectId(null)}
              className="p-2.5 bg-[#d6d6d6] hover:bg-[#c8c8c8] dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl transition-all shadow-sm flex items-center justify-center"
            >
              <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
            </button>
            <h1 className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
              {selectedProj?.title}
            </h1>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-white/40 dark:bg-white/5 border border-dashed border-zinc-400/40 rounded-2xl">
            <h3 className="text-zinc-800 dark:text-zinc-300 font-extrabold text-base mb-1">Project Details Coming Soon</h3>
            <p className="text-xs text-zinc-655 dark:text-zinc-405 max-w-sm">
              Interactive wiring maps, system topologies, and IoT controller bindings are currently being populated for {selectedProj?.title}.
            </p>
          </div>
        </div>
      );
    }

    // 1. Level 1: Sub-projects list grid (Matches Figma screenshot 100%)
    return (
      <div className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
          {subProjects.map((sub) => (
            <div
              key={sub.id}
              onClick={() => setSelectedSubProjectId(sub.id)}
              className="bg-[#d6d6d6] dark:bg-zinc-900 rounded-[24px] p-6 aspect-[4/5] flex flex-col justify-between cursor-pointer hover:scale-[1.02] hover:bg-[#c8c8c8] dark:hover:bg-zinc-850 transition-all duration-200 border border-zinc-350/30 dark:border-zinc-800/40 group relative overflow-hidden shadow-sm"
            >
              {/* Huge Number */}
              <span className="text-[95px] font-black leading-none text-white dark:text-zinc-800/60 select-none transition-transform duration-200 group-hover:scale-105 inline-block">
                {sub.id}
              </span>
              {/* Title */}
              <span className="text-[11px] font-bold text-zinc-800 dark:text-zinc-300 leading-tight uppercase tracking-wider mt-auto select-none">
                {sub.title}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full w-full relative">
      {/* Content Area - occupy full page width */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto h-full flex flex-col">
          {renderActiveView()}
        </div>
      </div>

      {/* Click Feedback Toast Alert Notification */}
      {activeNotification && (
        <div className="fixed bottom-6 right-6 z-[200] bg-zinc-900 border border-white/10 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom duration-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-xs font-bold tracking-tight">{activeNotification}</span>
        </div>
      )}

      {/* Video Modal Overlay */}
      {activeVideo && (
        <div className="fixed inset-0 z-[250] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-200">
          <div className="bg-zinc-950 border border-white/10 rounded-3xl overflow-hidden max-w-4xl w-full shadow-2xl relative aspect-video flex flex-col">
            <div className="absolute top-4 right-4 z-10">
              <button 
                onClick={() => setActiveVideo(null)}
                className="p-2 bg-black/60 hover:bg-black/90 text-white rounded-full transition-all border border-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <video 
              src={activeVideo}
              className="w-full h-full object-cover"
              autoPlay
              controls
              playsInline
            />
          </div>
        </div>
      )}
    </div>
  );
}
