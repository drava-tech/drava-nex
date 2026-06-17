"use client";

import React, { useState } from "react";
import { ArrowLeft, Play, X } from "lucide-react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { SubProjectsList } from "./sub-projects-list";
import { VerticalsGrid } from "./verticals-grid";
import { ExperienceCenterConsole } from "./experience-center-console";

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
    videoUrl: "/experience_intro.mp4",
    thumbnailUrl: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=650&q=80"
  },
  {
    id: "architecture-interiors",
    title: "Architecture & Interiors",
    videoUrl: "/tusker_presentation.mov",
    thumbnailUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=650&q=80"
  },
  {
    id: "brand-solutions",
    title: "Brand Solutions",
    videoUrl: "/brand_solutions_loop.webm",
    thumbnailUrl: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=650&q=80"
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const projectParam = searchParams.get("project");
  const dashboardParam = searchParams.get("dashboard");

  const selectedSubProjectId = projectParam ? parseInt(projectParam, 10) : null;
  const showExperienceCenterDashboard = dashboardParam === "true";

  const setSelectedSubProjectId = (id: number | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id !== null) {
      params.set("project", id.toString());
    } else {
      params.delete("project");
      params.delete("dashboard");
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  const setShowExperienceCenterDashboard = (val: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val) {
      params.set("dashboard", "true");
    } else {
      params.delete("dashboard");
    }
    router.push(`${pathname}?${params.toString()}`);
  };

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
        <ExperienceCenterConsole
          triggerBlockAction={triggerBlockAction}
        />
      );
    }

    // 2. Level 2: Intermediate Verticals Grid
    if (selectedSubProjectId === 1 && !showExperienceCenterDashboard) {
      return (
        <VerticalsGrid
          verticals={verticals}
          onSelectVertical={(id) => {
            if (id === "experience-center") {
              setShowExperienceCenterDashboard(true);
            } else {
              const selectedProj = verticals.find(v => v.id === id);
              if (selectedProj) triggerBlockAction(selectedProj.title);
            }
          }}
          onWatchVideo={setActiveVideo}
        />
      );
    }

    if (selectedSubProjectId !== null) {
      // Placeholder details for projects 2-8
      const selectedProj = subProjects.find(p => p.id === selectedSubProjectId);
      return (
        <div className="flex-1 w-full flex flex-col gap-6 select-none h-full">
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
            <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-sm">
              Interactive wiring maps, system topologies, and IoT controller bindings are currently being populated for {selectedProj?.title}.
            </p>
          </div>
        </div>
      );
    }

    // 1. Level 1: Sub-projects list grid
    return (
      <SubProjectsList
        subProjects={subProjects}
        onSelectProject={setSelectedSubProjectId}
      />
    );
  };

  return (
    <div className="flex flex-col h-full w-full relative overflow-hidden">
      {/* Content Area - occupy full page width */}
      <div className="flex-1 overflow-hidden">
        <div className="w-full h-full flex flex-col">
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
