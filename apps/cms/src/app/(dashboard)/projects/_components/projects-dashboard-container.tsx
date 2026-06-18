"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { SubProjectsList } from "./sub-projects-list";
import type { Vertical } from "@/types/projects";

interface ProjectsDashboardContainerProps {
  user: {
    name: string;
    role?: string;
    email?: string;
  };
  verticals: Vertical[];
}

export function ProjectsDashboardContainer({ user: _user, verticals }: ProjectsDashboardContainerProps) {
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
      <div className="flex-1 overflow-hidden min-h-0 h-full flex flex-col">
        <div className="w-full h-full flex flex-col overflow-hidden min-h-0 flex-1 mt-4">
          <SubProjectsList
            subProjects={mainProjects}
            onSelectProject={handleSelectProject}
          />
        </div>
      </div>
    </div>
  );
}
