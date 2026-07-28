"use client";

import React from "react";

interface SubProject {
  id: number;
  slug: string;
  title: string;
}

interface SubProjectsListProps {
  subProjects: SubProject[];
  onSelectProject: (slug: string) => void;
}

export function SubProjectsList({ subProjects, onSelectProject }: SubProjectsListProps) {
  return (
    <div className="w-full h-full flex flex-col justify-between p-2 overflow-hidden flex-1">
      <div className="grid grid-cols-2 lg:grid-cols-4 grid-rows-4 lg:grid-rows-2 gap-6 w-full h-full flex-1 min-h-0">
        {subProjects.map((sub) => (
          <div
            key={sub.slug}
            onClick={() => onSelectProject(sub.slug)}
            className="bg-[#d6d6d6] dark:bg-zinc-900 rounded-[28px] p-8 pb-10 flex flex-col justify-start gap-4 cursor-pointer hover:scale-[1.01] hover:bg-[#c8c8c8] dark:hover:bg-zinc-800 transition-all duration-200 border border-zinc-300/40 dark:border-zinc-800/50 group relative overflow-hidden shadow-sm h-full min-h-0 select-none"
          >
            {/* Huge Number */}
            <span className="text-[100px] sm:text-[120px] lg:text-[140px] xl:text-[160px] font-normal leading-[0.75] text-white dark:text-zinc-800/35 select-none transition-transform duration-200 group-hover:scale-105 inline-block -mt-5 -ml-4">
              {sub.id}
            </span>
            {/* Title */}
            <span className="text-[17px] font-normal text-zinc-900 dark:text-zinc-100 leading-snug uppercase tracking-wide select-none">
              {sub.title.toLowerCase() === "the white tusker portfolio" ? "The White Tusker PORT-FOLIO" : sub.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
