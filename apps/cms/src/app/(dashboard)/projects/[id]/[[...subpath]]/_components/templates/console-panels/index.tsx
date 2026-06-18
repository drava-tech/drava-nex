"use client";

import React from "react";
import { ArrowLeft } from "lucide-react";
import type { TemplateProps } from "../types";
import type { ConsolePanelsConfig, Panel } from "@/types/projects";

export function ConsolePanelsTemplate({
  project,
  subpath: _subpath,
  onBack,
  onNotify,
}: TemplateProps<ConsolePanelsConfig>) {
  const panels: Panel[] = (project.config as ConsolePanelsConfig).panels ?? [];
  const colClass =
    panels.length === 1
      ? "lg:grid-cols-1"
      : panels.length === 2
        ? "lg:grid-cols-2"
        : panels.length === 3
          ? "lg:grid-cols-3"
          : "lg:grid-cols-4";

  return (
    <div className="flex-1 w-full flex flex-col gap-6 select-none h-full">
      <div className="flex items-center gap-3 pb-4 border-b border-zinc-400/30 shrink-0">
        <button
          onClick={onBack}
          className="p-2.5 bg-[#d6d6d6] hover:bg-[#c8c8c8] dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl transition-all shadow-sm flex items-center justify-center"
          title="Go back"
        >
          <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
        </button>
        <h1 className="text-3xl font-normal text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
          {project.verticalTitle}
        </h1>
      </div>

      <div className={`grid grid-cols-1 ${colClass} gap-8 lg:gap-12 relative flex-1 min-h-0 overflow-y-auto py-2`}>
        {panels.length > 1 &&
          panels.slice(0, -1).map((_, i) => (
            <div
              key={i}
              className="hidden lg:block absolute top-0 bottom-0 w-[1px] bg-zinc-400/40"
              style={{ left: `${((i + 1) / panels.length) * 100}%` }}
            />
          ))}

        {panels.map((panel) => (
          <div key={panel.id} className="flex flex-col gap-4">
            <h2 className="text-2xl font-normal text-zinc-900 dark:text-zinc-100 text-center pb-2">
              {panel.title}
            </h2>

            {panel.items.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-8 bg-white/40 dark:bg-white/5 border border-dashed border-zinc-400/40 rounded-2xl">
                <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center">
                  Projects coming soon
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {panel.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onNotify(item.label)}
                    className="bg-[#8a8a8a] hover:bg-zinc-700 dark:hover:bg-zinc-600 text-white rounded-xl text-[9px] font-normal uppercase tracking-wider text-center flex items-center justify-center p-3 min-h-[60px] active:scale-95 transition-all shadow-sm"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
