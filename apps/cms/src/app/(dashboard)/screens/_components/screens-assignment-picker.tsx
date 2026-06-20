"use client";

import { X, Check } from "lucide-react";
import type { WsContent } from "@platform/types";

interface ScreenAssignmentPickerProps {
  screenName: string;
  currentContentLabel?: string;
  experiences: { id: string; title: string }[];
  onAssign: (content: WsContent) => void;
  onClose: () => void;
}

export function ScreenAssignmentPicker({
  screenName,
  currentContentLabel,
  experiences,
  onAssign,
  onClose,
}: ScreenAssignmentPickerProps) {
  const handleSelect = (item: { id: string; title: string }) => {
    onAssign({
      id: item.id,
      type: "experience",
      source: "",
      title: item.title,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-t-3xl md:rounded-3xl p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[9px] font-bold text-zinc-500 tracking-[0.25em] uppercase mb-0.5">
              assign content
            </p>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wide">
              {screenName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Experiences */}
        <div>
          <p className="text-[9px] font-bold text-zinc-500 tracking-[0.2em] uppercase mb-3">
            Experiences
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {experiences.length === 0 ? (
              <p className="col-span-3 text-xs text-zinc-400 dark:text-zinc-600 py-4">
                No experiences created yet.
              </p>
            ) : (
              experiences.map((item) => {
                const isActive = currentContentLabel === item.title;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className={`relative flex flex-col items-start justify-end rounded-2xl border p-4 h-20 transition-all duration-200 text-left overflow-hidden
                      ${isActive
                        ? "border-zinc-900 dark:border-zinc-300 bg-zinc-200 dark:bg-zinc-800"
                        : "border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
                      }`}
                  >
                    <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1">
                      Experience
                    </span>
                    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 leading-tight truncate w-full">
                      {item.title}
                    </span>
                    {isActive && (
                      <Check className="absolute top-3 right-3 h-3.5 w-3.5 text-green-500 dark:text-green-400 shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
