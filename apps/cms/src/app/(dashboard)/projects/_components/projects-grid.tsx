"use client";

import React, { useState } from "react";
import Link from "next/link";
import { X, Play } from "lucide-react";

export function ProjectsGrid() {
  const [activeVideo, setActiveVideo] = useState<string | null>(null);

  const verticals = [
    { 
      id: "experience-center", 
      title: "Experience Center",
      videoUrl: "/experience_intro.mp4" 
    },
    { 
      id: "architecture-interiors", 
      title: "Architecture & Interiors",
      videoUrl: "/tusker_presentation.mov" 
    },
    { 
      id: "brand-solutions", 
      title: "Brand Solutions",
      videoUrl: "/brand_solutions_loop.webm" 
    },
  ];

  return (
    <div className="w-full flex-1 flex flex-col gap-6 min-h-0 overflow-hidden relative">
      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 w-full max-w-[1450px] mx-auto flex-1 min-h-0 overflow-hidden">
        {verticals.map((vertical) => (
          <div
            key={vertical.id}
            className="bg-[#e1e1e1] dark:bg-zinc-900 border border-zinc-300/70 dark:border-zinc-800/80 rounded-3xl p-6 flex flex-col gap-6 shadow-sm h-full min-h-0 overflow-hidden"
          >
            {/* Title Section */}
            <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 tracking-tight leading-tight shrink-0">
              {vertical.title}
            </h3>

            {/* Gray Portrait Box with subtle play button overlay indicating watchable content */}
            <div 
              onClick={() => setActiveVideo(vertical.videoUrl)}
              className="flex-1 min-h-0 bg-[#d6d6d6] dark:bg-zinc-800/50 rounded-2xl border border-zinc-300/40 dark:border-zinc-700/20 cursor-pointer group relative overflow-hidden flex items-center justify-center transition-all duration-300 hover:bg-[#cccccc] dark:hover:bg-zinc-850"
            >
              <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="w-14 h-14 rounded-full bg-white/90 dark:bg-zinc-900/90 flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-110">
                <Play className="h-6 w-6 text-zinc-800 dark:text-zinc-200 fill-zinc-800 dark:fill-zinc-200 ml-1" />
              </div>
            </div>

            {/* Action Buttons Stack */}
            <div className="flex flex-col gap-3 shrink-0">
              <button 
                onClick={() => setActiveVideo(vertical.videoUrl)}
                className="w-full py-3 px-6 bg-[#3f3f46] hover:bg-[#27272a] dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white rounded-full text-sm font-semibold transition-all duration-200 shadow-md text-center"
              >
                Watch Video
              </button>
              <Link 
                href={`/projects/${vertical.id}`}
                className="w-full py-3 px-6 bg-[#3f3f46] hover:bg-[#27272a] dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white rounded-full text-sm font-semibold transition-all duration-200 shadow-md text-center block"
              >
                Projects
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Video Modal Overlay */}
      {activeVideo && (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-200">
          <div className="bg-zinc-950 border border-white/10 rounded-3xl overflow-hidden max-w-4xl w-full shadow-2xl relative aspect-video flex flex-col">
            {/* Modal header details */}
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
