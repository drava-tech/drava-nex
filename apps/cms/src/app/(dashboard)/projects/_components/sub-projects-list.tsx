"use client";

import React from "react";

interface SubProject {
  id: number;
  title: string;
}

interface SubProjectsListProps {
  subProjects: SubProject[];
  onSelectProject: (id: number) => void;
}

export function SubProjectsList({ subProjects, onSelectProject }: SubProjectsListProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0 h-full w-full p-2">
      <div className="grid grid-cols-2 lg:grid-cols-4 grid-rows-4 lg:grid-rows-2 gap-4 w-full flex-1 min-h-0">
        {subProjects.map((sub) => (
          <div
            key={sub.id}
            onClick={() => onSelectProject(sub.id)}
            className="bg-[#d6d6d6] dark:bg-zinc-900 rounded-[24px] p-6 flex flex-col justify-start items-start gap-2 cursor-pointer hover:scale-[1.02] hover:bg-[#c8c8c8] dark:hover:bg-zinc-850 transition-all duration-200 border border-zinc-350/30 dark:border-zinc-800/40 group relative overflow-hidden shadow-sm h-full"
          >
            {/* Huge Number */}
            <span className="text-[110px] font-black leading-[0.8] text-white dark:text-zinc-800/50 select-none transition-transform duration-200 group-hover:scale-105 inline-block">
              {sub.id}
            </span>
            {/* Title */}
            <span className="text-[17px] font-extrabold text-zinc-900 dark:text-zinc-100 leading-tight uppercase tracking-wide select-none mt-2">
              {sub.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
