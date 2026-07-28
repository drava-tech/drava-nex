"use client";

import React from "react";
import { ArrowLeft } from "lucide-react";

interface Vertical {
  id: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
}

interface VerticalsGridProps {
  verticals: Vertical[];
  onSelectVertical: (id: string) => void;
  onWatchVideo: (url: string) => void;
  onBack?: () => void;
}

export function VerticalsGrid({ verticals, onSelectVertical, onWatchVideo, onBack }: VerticalsGridProps) {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 select-none h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-zinc-400/30">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2.5 bg-[#d6d6d6] hover:bg-[#c8c8c8] dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl transition-all shadow-sm flex items-center justify-center mr-1"
              title="Go back to projects"
            >
              <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-normal text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
              The White Tusker PORT-FOLIO
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Select a vertical category below to configure signage feeds.
            </p>
          </div>
        </div>
      </div>

      {/* Three verticals grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 w-full flex-1 min-h-0 py-2">
        {verticals.map((vertical) => (
          <div
            key={vertical.id}
            className="bg-[#d6d6d6] dark:bg-zinc-900 border border-zinc-350 dark:border-zinc-800/80 rounded-2xl p-6 flex flex-col gap-6 shadow-sm h-full"
          >
            {/* Title Section */}
            <h3 className="text-xl font-normal text-zinc-900 dark:text-zinc-50 tracking-tight leading-tight">
              {vertical.title}
            </h3>

            {/* Thumbnail Box (Non-clickable, no play button) */}
            <div className="flex-1 min-h-[160px] bg-white/40 dark:bg-zinc-800/50 rounded-xl border border-zinc-350/40 dark:border-zinc-700/20 relative overflow-hidden flex items-center justify-center">
              <img
                src={vertical.thumbnailUrl}
                alt={vertical.title}
                className="absolute inset-0 w-full h-full object-cover opacity-90 dark:opacity-85 pointer-events-none"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => onWatchVideo(vertical.videoUrl)}
                className="w-full py-2.5 bg-[#8a8a8a] hover:bg-[#7a7a7a] dark:bg-zinc-850 dark:hover:bg-zinc-850/80 text-white rounded-full text-xs font-normal transition-all duration-205 shadow-sm text-center"
              >
                Watch Video
              </button>
              <button
                onClick={() => onSelectVertical(vertical.id)}
                className="w-full py-2.5 bg-black hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 text-white rounded-full text-xs font-normal transition-all duration-200 shadow-sm text-center"
              >
                Projects
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
