"use client";

import React, { useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { SubProjectsList } from "../../../_components/sub-projects-list";
import { VerticalsGrid } from "../../../_components/verticals-grid";
import "./templates";
import { getTemplate } from "./templates/template-registry";
import type { ResolvedProject } from "./templates/types";
import type { Vertical } from "@/types/projects";

interface ProjectRouterProps {
  user: {
    name: string;
    role?: string;
    email?: string;
  };
  projectId: string;
  subpath: string[];
  verticals: Vertical[];
}

export function ProjectRouter({ user: _user, projectId, subpath, verticals }: ProjectRouterProps) {
  const router = useRouter();
  const [activeVideo, setActiveVideo] = useState<string | null>(null);
  const [activeNotification, setActiveNotification] = useState<string | null>(null);

  const triggerBlockAction = (name: string) => {
    setActiveNotification(`Command executed: Loaded '${name}' configuration.`);
    setTimeout(() => setActiveNotification(null), 3000);
  };

  const renderActiveView = () => {
    // ── Portfolio: /projects/the-white-tusker-portfolio/[category]/[project]/[...templateSubpath]
    if (projectId === "the-white-tusker-portfolio") {
      const categoryId = subpath[0];
      const projectSlug = subpath[1];
      const templateSubpath = subpath.slice(2);

      // Level 4 — project template
      if (categoryId && projectSlug) {
        const currentCategory = verticals.find((c) => c.id === categoryId);
        const selectedProj = currentCategory?.projects.find((p) => p.slug === projectSlug);

        const handleBack = () =>
          router.push(`/projects/the-white-tusker-portfolio/${categoryId}`);

        const projectType = selectedProj?.type;
        const projectConfig = selectedProj?.config ?? {};

        if (projectType) {
          const TemplateComponent = getTemplate(projectType);
          if (TemplateComponent) {
            const resolvedProject: ResolvedProject = {
              slug: projectSlug,
              title: selectedProj?.title ?? projectSlug,
              type: projectType,
              config: projectConfig,
              verticalId: currentCategory?.id ?? "",
              verticalTitle: currentCategory?.title ?? "",
            };
            return (
              <div className="flex-1 w-full h-full flex flex-col justify-between overflow-hidden min-h-0">
                <TemplateComponent
                  project={resolvedProject}
                  subpath={templateSubpath}
                  onBack={handleBack}
                  onNotify={triggerBlockAction}
                />
              </div>
            );
          }
        }

        // Coming Soon fallback for portfolio projects without a type
        return (
          <div className="flex-1 w-full h-full flex flex-col justify-between overflow-hidden min-h-0">
            <div className="flex items-center gap-3 pb-4 border-b border-zinc-400/30 shrink-0">
              <button
                onClick={handleBack}
                className="p-2.5 bg-[#d6d6d6] hover:bg-[#c8c8c8] dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl transition-all shadow-sm flex items-center justify-center"
                title="Go back"
              >
                <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
              </button>
              <h1 className="text-2xl font-normal text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
                {selectedProj?.title || projectSlug}
              </h1>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-white/40 dark:bg-white/5 border border-dashed border-zinc-400/40 rounded-2xl mt-4">
              <h3 className="text-zinc-800 dark:text-zinc-300 font-normal text-base mb-1">
                Project Details Coming Soon
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-sm">
                Interactive wiring maps, system topologies, and IoT controller bindings are
                currently being populated for {selectedProj?.title || projectSlug}.
              </p>
            </div>
          </div>
        );
      }

      // Level 3 — category page
      if (categoryId) {
        const currentCategory = verticals.find((c) => c.id === categoryId);
        if (currentCategory) {
          const handleBackToPortfolio = () => router.push("/projects/the-white-tusker-portfolio");
          const verticalType = currentCategory.type;

          // If the vertical has a type, show its template directly (skip sub-projects list)
          if (verticalType) {
            const TemplateComponent = getTemplate(verticalType);
            if (TemplateComponent) {
              const resolvedProject: ResolvedProject = {
                slug: categoryId,
                title: currentCategory.title,
                type: verticalType,
                config: currentCategory.config ?? {},
                verticalId: currentCategory.id,
                verticalTitle: currentCategory.title,
              };
              return (
                <div className="flex-1 w-full h-full flex flex-col justify-between overflow-hidden min-h-0">
                  <TemplateComponent
                    project={resolvedProject}
                    subpath={[]}
                    onBack={handleBackToPortfolio}
                    onNotify={triggerBlockAction}
                  />
                </div>
              );
            }
          }

          // No vertical type — show sub-projects list
          return (
            <div className="flex-1 w-full h-full flex flex-col justify-between overflow-hidden min-h-0">
              <div className="flex items-center gap-3 pb-4 border-b border-zinc-400/30 shrink-0">
                <button
                  onClick={handleBackToPortfolio}
                  className="p-2.5 bg-[#d6d6d6] hover:bg-[#c8c8c8] dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl transition-all shadow-sm flex items-center justify-center"
                  title="Go back to categories"
                >
                  <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
                </button>
                <div>
                  <h1 className="text-2xl font-normal text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
                    {currentCategory.title}
                  </h1>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    Select a project below to view its console and details.
                  </p>
                </div>
              </div>
              <div className="flex-1 min-h-0 w-full overflow-hidden mt-4">
                <SubProjectsList
                  subProjects={currentCategory.projects}
                  onSelectProject={(slug) =>
                    router.push(`/projects/the-white-tusker-portfolio/${categoryId}/${slug}`)
                  }
                />
              </div>
            </div>
          );
        }
      }

      // Level 2 — portfolio home: verticals grid
      return (
        <div className="flex-1 w-full h-full flex flex-col justify-between overflow-hidden min-h-0">
          <VerticalsGrid
            verticals={verticals}
            onSelectVertical={(id) => router.push(`/projects/the-white-tusker-portfolio/${id}`)}
            onWatchVideo={setActiveVideo}
            onBack={() => router.push("/projects")}
          />
        </div>
      );
    }

    // ── Non-portfolio projects: template lookup by projectId
    const projectCategoryObj = verticals.find((c) =>
      c.projects.some((p) => p.slug === projectId)
    );
    const selectedProj = projectCategoryObj?.projects.find((p) => p.slug === projectId);

    const handleBackFromProject = () => router.push("/projects");

    const projectType = selectedProj?.type;
    const projectConfig = selectedProj?.config ?? {};

    if (projectType) {
      const TemplateComponent = getTemplate(projectType);
      if (TemplateComponent) {
        const resolvedProject: ResolvedProject = {
          slug: projectId,
          title: selectedProj?.title ?? projectId,
          type: projectType,
          config: projectConfig,
          verticalId: projectCategoryObj?.id ?? "",
          verticalTitle: projectCategoryObj?.title ?? "",
        };
        return (
          <div className="flex-1 w-full h-full flex flex-col justify-between overflow-hidden min-h-0">
            <TemplateComponent
              project={resolvedProject}
              subpath={subpath}
              onBack={handleBackFromProject}
              onNotify={triggerBlockAction}
            />
          </div>
        );
      }
    }

    return (
      <div className="flex-1 w-full h-full flex flex-col justify-between overflow-hidden min-h-0">
        <div className="flex items-center gap-3 pb-4 border-b border-zinc-400/30 shrink-0">
          <button
            onClick={handleBackFromProject}
            className="p-2.5 bg-[#d6d6d6] hover:bg-[#c8c8c8] dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl transition-all shadow-sm flex items-center justify-center"
            title="Go back"
          >
            <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
          </button>
          <h1 className="text-2xl font-normal text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
            {selectedProj?.title || projectId}
          </h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-white/40 dark:bg-white/5 border border-dashed border-zinc-400/40 rounded-2xl mt-4">
          <h3 className="text-zinc-800 dark:text-zinc-300 font-normal text-base mb-1">
            Project Details Coming Soon
          </h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-sm">
            Interactive wiring maps, system topologies, and IoT controller bindings are currently
            being populated for {selectedProj?.title || projectId}.
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full w-full relative overflow-hidden flex-1">
      <div className="flex-1 overflow-hidden min-h-0 h-full flex flex-col">
        <div className="w-full h-full flex flex-col overflow-hidden min-h-0 flex-1">
          {renderActiveView()}
        </div>
      </div>

      {activeNotification && (
        <div className="fixed bottom-6 right-6 z-[200] bg-zinc-900 border border-white/10 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom duration-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-xs font-normal tracking-tight">{activeNotification}</span>
        </div>
      )}

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
