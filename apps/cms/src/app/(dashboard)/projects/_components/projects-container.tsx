"use client";

import React, { useState } from "react";
import Link from "next/link";
import { User, ChevronUp, ArrowLeft, Play, RefreshCw, Power } from "lucide-react";
import { InteractionsView } from "./interactions-view";
import { DashboardView } from "./dashboard-view";
import { EnvironmentView } from "./environment-view";
import { WelcomeView } from "./welcome-view";
import { AddFilesView } from "./add-files-view";

const projects = [
  { id: "experience-center", title: "Experience Center" },
  { id: "architecture-interiors", title: "Architecture & Interiors" },
  { id: "brand-solutions", title: "Brand Solutions" },
];

type TabType = "projects" | "interactions" | "dashboard" | "environment" | "welcome" | "add-files";

interface ProjectsContainerProps {
  user: {
    name: string;
    role?: string;
    email?: string;
  };
  projectId: string;
}

export function ProjectsContainer({ user, projectId }: ProjectsContainerProps) {
  const [activeTab, setActiveTab] = useState<TabType>("projects");
  const [activeNotification, setActiveNotification] = useState<string | null>(null);

  const currentProject = projects.find(p => p.id === projectId) ?? { id: "experience-center", title: "Experience Center" };

  const tabs = [
    { id: "projects", label: "Project Details" },
    { id: "interactions", label: "Interactions" },
    { id: "dashboard", label: "Dashboard" },
    { id: "environment", label: "Environment" },
    { id: "welcome", label: "Welcome" },
    { id: "add-files", label: "Add Files" },
  ] as const;

  const triggerBlockAction = (name: string) => {
    setActiveNotification(`Command executed: Loaded '${name}' configuration.`);
    setTimeout(() => {
      setActiveNotification(null);
    }, 3000);
  };

  // Render the special layout for Experience Center
  if (projectId === "experience-center") {
    return (
      <div className="flex-1 w-full flex flex-col gap-6 select-none bg-[#e1e1e1] dark:bg-zinc-950 p-6 md:p-8 rounded-3xl border border-zinc-350 dark:border-zinc-800 shadow-xl overflow-y-auto">
        {/* Header with back button */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-400/30">
          <div className="flex items-center gap-3">
            <Link
              href="/projects"
              className="p-2.5 bg-[#d6d6d6] hover:bg-[#c8c8c8] dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl transition-all shadow-sm flex items-center justify-center"
              title="Back to Projects"
            >
              <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
            </Link>
            <h1 className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
              Experience Center
            </h1>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] uppercase tracking-wider font-extrabold text-zinc-600 dark:text-zinc-400">
              Interactive Signage Console
            </span>
          </div>
        </div>

        {/* Two-Column Grid (Build and Technology) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 relative flex-1 min-h-0 py-2">
          
          {/* Vertical Divider line */}
          <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-[1px] bg-zinc-400/40 -translate-x-1/2" />

          {/* Left Column: Build */}
          <div className="flex flex-col gap-6">
            <h2 className="text-xl font-extrabold text-zinc-800 dark:text-zinc-300 text-center uppercase tracking-widest pb-2">
              Build
            </h2>

            <div className="flex flex-col gap-3">
              {/* Build Row 1 */}
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-1 flex flex-col gap-2">
                  <button 
                    onClick={() => triggerBlockAction("Concept Design")}
                    className="flex-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[48px] active:scale-95 transition-all shadow-sm"
                  >
                    Concept Design
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("Schematic Flow")}
                    className="flex-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[48px] active:scale-95 transition-all shadow-sm"
                  >
                    Schematic Flow
                  </button>
                </div>
                <button 
                  onClick={() => triggerBlockAction("Lego Kits Integration")}
                  className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Lego Kits Integration
                </button>
                <button 
                  onClick={() => triggerBlockAction("Floor Layout Blueprint")}
                  className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Floor Layout
                </button>
              </div>

              {/* Build Row 2 */}
              <div className="grid grid-cols-4 gap-3">
                <button 
                  onClick={() => triggerBlockAction("Structural Integrity Model")}
                  className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Structural Model
                </button>
                <button 
                  onClick={() => triggerBlockAction("Assembly Line Simulation")}
                  className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Assembly Line Simulation
                </button>
                <button 
                  onClick={() => triggerBlockAction("EHS Safety Protocols")}
                  className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  EHS Safety
                </button>
              </div>

              {/* Build Row 3 */}
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-1 flex flex-col gap-2">
                  <button 
                    onClick={() => triggerBlockAction("Electrical Routing Map")}
                    className="flex-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[48px] active:scale-95 transition-all shadow-sm"
                  >
                    Electrical Map
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("HVAC Circulation Loop")}
                    className="flex-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[48px] active:scale-95 transition-all shadow-sm"
                  >
                    HVAC Loop
                  </button>
                </div>
                <button 
                  onClick={() => triggerBlockAction("Digital Twin Sync Panel")}
                  className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Digital Twin Sync
                </button>
                <button 
                  onClick={() => triggerBlockAction("Human Aping Diagnostics")}
                  className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Human Aping
                </button>
              </div>

              {/* Build Row 4 */}
              <div className="grid grid-cols-4 gap-3">
                <button 
                  onClick={() => triggerBlockAction("Object Detection Node")}
                  className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Object Detection
                </button>
                <button 
                  onClick={() => triggerBlockAction("Exhibition Playback Controller")}
                  className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Playback Controller
                </button>
                <button 
                  onClick={() => triggerBlockAction("Lobby Screen A Manager")}
                  className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Lobby Screen
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Technology */}
          <div className="flex flex-col gap-6">
            <h2 className="text-xl font-extrabold text-zinc-800 dark:text-zinc-300 text-center uppercase tracking-widest pb-2">
              Technology
            </h2>

            <div className="flex flex-col gap-3">
              {/* Tech Row 1 */}
              <div className="grid grid-cols-5 gap-3">
                <button 
                  onClick={() => triggerBlockAction("IoT Gateway Nodes")}
                  className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  IoT Gateway
                </button>
                <button 
                  onClick={() => triggerBlockAction("Sensor Telemetry Stream")}
                  className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Telemetry Stream
                </button>
                <button 
                  onClick={() => triggerBlockAction("Cloud Broker")}
                  className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Cloud
                </button>
              </div>

              {/* Tech Row 2 */}
              <div className="grid grid-cols-5 gap-3">
                <button 
                  onClick={() => triggerBlockAction("MQTT Bridge")}
                  className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  MQTT
                </button>
                <button 
                  onClick={() => triggerBlockAction("Edge Analytics Processor")}
                  className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Edge Analytics
                </button>
                <div className="col-span-2 flex flex-col gap-2">
                  <button 
                    onClick={() => triggerBlockAction("Node-Red Orchestrator")}
                    className="flex-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[48px] active:scale-95 transition-all shadow-sm"
                  >
                    Node-Red
                  </button>
                  <button 
                    onClick={() => triggerBlockAction("Modbus Serial Sync")}
                    className="flex-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[48px] active:scale-95 transition-all shadow-sm"
                  >
                    Modbus Serial
                  </button>
                </div>
              </div>

              {/* Tech Row 3 */}
              <div className="grid grid-cols-5 gap-3">
                <button 
                  onClick={() => triggerBlockAction("BACnet Router")}
                  className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  BACnet Router
                </button>
                <button 
                  onClick={() => triggerBlockAction("SCADA Dashboard Host")}
                  className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  SCADA Host
                </button>
                <button 
                  onClick={() => triggerBlockAction("D1 Persistence Database")}
                  className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  D1 DB
                </button>
              </div>

              {/* Tech Row 4 */}
              <div className="grid grid-cols-5 gap-3">
                <button 
                  onClick={() => triggerBlockAction("Wrangler Dev Server")}
                  className="col-span-1 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Wrangler
                </button>
                <button 
                  onClick={() => triggerBlockAction("Durable Objects Coordinator")}
                  className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Durable Objects
                </button>
                <button 
                  onClick={() => triggerBlockAction("Workers AI Classifier")}
                  className="col-span-2 bg-[#8a8a8a] dark:bg-zinc-800 hover:bg-zinc-700 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider text-center flex items-center justify-center p-4 min-h-[104px] active:scale-95 transition-all shadow-sm"
                >
                  Workers AI
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* Click Feedback Toast Alert Notification */}
        {activeNotification && (
          <div className="fixed bottom-6 right-6 z-[200] bg-zinc-900 border border-white/10 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom duration-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-bold tracking-tight">{activeNotification}</span>
          </div>
        )}
      </div>
    );
  }

  // Fallback to default tabbed layout for other projects
  const renderActiveView = () => {
    switch (activeTab) {
      case "projects":
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-3">
                <Link
                  href="/projects"
                  className="p-2 text-zinc-500 hover:text-black hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Project Profile</h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">General settings, configuration metadata, and deployment details.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Profile Card */}
              <div className="bg-[#f4f4f5] dark:bg-zinc-900 rounded-xl p-6 border border-zinc-200 dark:border-zinc-800 space-y-6 lg:col-span-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-950/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:text-emerald-400">
                      Active
                    </span>
                    <h3 className="text-2xl font-bold text-zinc-900 dark:text-white">{currentProject.title}</h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      This project hosts interactive media profiles, real-time sensor trackers, and content playlists mapped to the exhibition displays.
                    </p>
                  </div>
                  <div className="text-5xl font-light text-zinc-300 dark:text-zinc-700 leading-none select-none">
                    #ID
                  </div>
                </div>

                <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">Assigned Display</span>
                    <span className="font-medium text-zinc-900 dark:text-white mt-1 block">Lobby Display Screen A</span>
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">Last Deployed</span>
                    <span className="font-medium text-zinc-900 dark:text-white mt-1 block">Today, 14:32</span>
                  </div>
                </div>
              </div>

              {/* Action Controls */}
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
                <h4 className="font-semibold text-zinc-900 dark:text-white">Quick Deploy Operations</h4>
                <div className="space-y-2">
                  <button className="w-full flex items-center justify-between px-4 py-2.5 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800/50 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-sm transition-colors border border-zinc-200 dark:border-zinc-700">
                    <span className="font-medium">Force Sync Assets</span>
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button className="w-full flex items-center justify-between px-4 py-2.5 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800/50 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-sm transition-colors border border-zinc-200 dark:border-zinc-700">
                    <span className="font-medium">Restart Playback</span>
                    <Play className="h-4 w-4" />
                  </button>
                  <button className="w-full flex items-center justify-between px-4 py-2.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/40 text-red-700 dark:text-red-400 rounded-lg text-sm transition-colors border border-red-200 dark:border-red-900/30">
                    <span className="font-medium">Standby Mode</span>
                    <Power className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      case "interactions":
        return <InteractionsView />;
      case "dashboard":
        return <DashboardView />;
      case "environment":
        return <EnvironmentView />;
      case "welcome":
        return <WelcomeView />;
      case "add-files":
        return <AddFilesView />;
      default:
        return <div>Not found</div>;
    }
  };

  return (
    <div className="flex flex-col md:flex-row border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xl min-h-[600px] h-full bg-white dark:bg-zinc-950 w-full">
      {/* Inner Sidebar */}
      <div className="w-full md:w-64 bg-zinc-300 dark:bg-zinc-900/60 p-6 flex flex-col justify-between border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full py-3 px-4 rounded-lg text-center font-medium text-sm transition-all shadow-sm ${
                    isActive
                      ? "bg-black text-white dark:bg-white dark:text-black font-semibold shadow-md scale-[1.02]"
                      : "bg-[#8a8a8a] hover:bg-[#7a7a7a] text-white dark:bg-zinc-800/80 dark:hover:bg-zinc-700/80 dark:text-zinc-200"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* User Profile Pill */}
        <div className="mt-8 md:mt-auto">
          <div className="bg-[#1e1e1e] dark:bg-black text-white rounded-lg p-3.5 flex items-center justify-between cursor-pointer border border-zinc-700/40 hover:bg-black/90 dark:hover:bg-zinc-900 transition-all shadow-md">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-full bg-zinc-700 dark:bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-600/40">
                <User className="h-4 w-4 text-zinc-300" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold truncate leading-tight">
                  {user.name || "Administrator"}
                </span>
                <span className="text-[10px] text-zinc-400 capitalize font-medium tracking-wide">
                  {user.role?.toLowerCase() || "guest"}
                </span>
              </div>
            </div>
            <ChevronUp className="h-4 w-4 text-zinc-400 shrink-0" />
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 p-6 md:p-8 overflow-y-auto bg-zinc-50 dark:bg-zinc-950/20">
        <div className="max-w-7xl mx-auto h-full">
          {renderActiveView()}
        </div>
      </div>
    </div>
  );
}
