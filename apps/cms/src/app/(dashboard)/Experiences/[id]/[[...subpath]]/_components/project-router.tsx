"use client";

import React from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Experience } from "@platform/db";
import { ExperienceTemplateView } from "./experience-template-view";

interface ProjectRouterProps {
  project: Experience;
  subpath: string[];
}

export function ProjectRouter({ project, subpath }: ProjectRouterProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col h-full w-full relative overflow-hidden flex-1">
      <div className="flex-1 overflow-hidden min-h-0 h-full flex flex-col">
        <div className="w-full h-full flex flex-col overflow-hidden min-h-0 flex-1">
          <div className="flex-1 w-full h-full flex flex-col overflow-hidden min-h-0">
            <div className="flex items-center gap-3 pb-4 border-b border-zinc-400/30 shrink-0">
              <button
                onClick={() => router.push("/experiences")}
                className="p-2.5 bg-[#d6d6d6] hover:bg-[#c8c8c8] dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl transition-all shadow-sm flex items-center justify-center"
                title="Go back"
              >
                <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
              </button>
              <div>
                <h1 className="text-2xl font-normal text-zinc-900 dark:text-zinc-50 tracking-tight leading-none uppercase">
                  {project.name}
                </h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 font-mono">
                  /{project.slug}
                </p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              <ExperienceTemplateView experience={project} subpath={subpath} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
