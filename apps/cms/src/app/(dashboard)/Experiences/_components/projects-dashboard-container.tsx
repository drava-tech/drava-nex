"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { SubProjectsList } from "./sub-projects-list";
import { ProjectsList } from "./projects-list";
import type { Vertical } from "@/types/projects";
import type { Project } from "@platform/db";

interface ProjectsDashboardContainerProps {
  user: {
    name: string;
    role?: string;
    email?: string;
  };
  verticals: Vertical[];
  dbProjects: Project[];
}

export function ProjectsDashboardContainer({ user: _user, verticals, dbProjects }: ProjectsDashboardContainerProps) {
  const router = useRouter();

  const mainProjects = [
    { id: 1, slug: "the-white-tusker-portfolio", title: "The White Tusker PORT-FOLIO" },
    ...verticals.flatMap((c) => c.projects),
  ];

  const handleSelectProject = (slug: string) => {
    router.push(`/projects/${slug}`);
  };

  return (
    <div className="flex flex-col h-full w-full relative overflow-hidden flex-1">
      <div className="flex-1 overflow-y-auto min-h-0 h-full flex flex-col">
        <div className="w-full flex flex-col overflow-hidden min-h-0 flex-shrink-0 mt-4" style={{ minHeight: "420px" }}>
          <SubProjectsList
            subProjects={mainProjects}
            onSelectProject={handleSelectProject}
          />
        </div>
        <div className="w-full flex-shrink-0 border-t border-zinc-800/50 pt-6 pb-6">
          <ProjectsList projects={dbProjects} />
        </div>
      </div>
    </div>
  );
}
