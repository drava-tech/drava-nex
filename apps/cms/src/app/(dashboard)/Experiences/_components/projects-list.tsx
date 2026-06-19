"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { CreateProjectModal } from "./create-project-modal";
import type { Project } from "@platform/db";

interface ProjectsListProps {
  projects: Project[];
}

export function ProjectsList({ projects }: ProjectsListProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);

  const handleClose = () => {
    setShowModal(false);
    router.refresh();
  };

  return (
    <>
      {showModal && <CreateProjectModal onClose={handleClose} />}

      <div className="flex flex-col gap-4 w-full">
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-bold text-zinc-500 tracking-[0.25em] uppercase">
            Experiences
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-300 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-700 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 text-[10px] font-bold uppercase tracking-wider transition-all duration-200"
          >
            <Plus className="h-3 w-3" />
            New Experience
          </button>
        </div>

        {projects.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-4 p-12 rounded-[28px] border border-dashed border-zinc-300 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-700 text-center cursor-pointer transition-colors group"
            onClick={() => setShowModal(true)}
          >
            <div className="h-10 w-10 rounded-2xl bg-zinc-200 group-hover:bg-zinc-300 dark:bg-zinc-900 dark:group-hover:bg-zinc-800 flex items-center justify-center transition-colors">
              <Plus className="h-5 w-5 text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-600 dark:group-hover:text-zinc-400" />
            </div>
            <div>
              <p className="text-sm font-normal text-zinc-500 dark:text-zinc-400">No experiences yet</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
                Click to create your first experience
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
            <div
              onClick={() => setShowModal(true)}
              className="bg-zinc-200/60 hover:bg-zinc-200 dark:bg-zinc-900/50 dark:hover:bg-zinc-900 border border-dashed border-zinc-300 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-700 rounded-[28px] p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-200 group min-h-[160px]"
            >
              <div className="h-8 w-8 rounded-xl bg-zinc-300 group-hover:bg-zinc-400 dark:bg-zinc-800 dark:group-hover:bg-zinc-700 flex items-center justify-center transition-colors">
                <Plus className="h-4 w-4 text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300" />
              </div>
              <span className="text-[10px] font-bold text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-600 dark:group-hover:text-zinc-400 uppercase tracking-wider transition-colors">
                New Experience
              </span>
            </div>

            {projects.map((proj, index) => (
              <div
                key={proj.id}
                onClick={() => router.push(`/projects/${proj.slug}`)}
                className="bg-[#d6d6d6] hover:bg-[#c8c8c8] dark:bg-zinc-900 dark:hover:bg-zinc-800 rounded-[28px] p-6 pb-8 flex flex-col justify-start gap-3 cursor-pointer hover:scale-[1.01] transition-all duration-200 border border-zinc-300/40 dark:border-zinc-800/50 group relative overflow-hidden shadow-sm min-h-[160px] select-none"
              >
                <span className="text-[80px] font-normal leading-[0.75] text-white dark:text-zinc-800/35 select-none transition-transform duration-200 group-hover:scale-105 inline-block -mt-3 -ml-3">
                  {index + 1}
                </span>
                <span className="text-[15px] font-normal text-zinc-900 dark:text-zinc-100 leading-snug uppercase tracking-wide select-none">
                  {proj.name}
                </span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-600 font-mono select-none -mt-1">
                  /{proj.slug}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
