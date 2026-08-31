"use client";

import { Radio, X } from "lucide-react";
import type { LiveScreen } from "./live-control-dialog";

interface ControlChooserDialogProps {
  contentName: string;
  screens: LiveScreen[];
  onChoose: (screen: LiveScreen) => void;
  onClose: () => void;
}

/**
 * Shown right after pushing to 2+ screens at once — control only mirrors one
 * screen at a time, so ask which one before opening LiveControlDialog.
 */
export function ControlChooserDialog({ contentName, screens, onChoose, onClose }: ControlChooserDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 select-none"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" />

      <div
        className="relative w-full max-w-md bg-white dark:bg-zinc-950 border border-[#432992] rounded-t-3xl md:rounded-3xl p-6 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden transition-all transform scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase mb-0.5">
              Pushed &ldquo;{contentName}&rdquo; to {screens.length} screens
            </p>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase">
              Which screen do you want to control?
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {screens.map((s) => (
            <button
              key={s.screenId}
              type="button"
              onClick={() => onChoose(s)}
              className="flex w-full items-center gap-3 rounded-2xl border border-[#432992] bg-zinc-50/50 dark:bg-zinc-900/40 hover:border-zinc-400 dark:hover:border-zinc-700 hover:bg-zinc-100/50 dark:hover:bg-zinc-850/50 p-4 text-left transition-all"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  s.isOnline ? "bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" : "bg-zinc-400"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-zinc-800 dark:text-zinc-200">
                  {s.screenName}
                </span>
                <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">
                  {s.isOnline ? "Online" : "Offline"}
                </span>
              </span>
              <Radio className="h-4 w-4 shrink-0 text-zinc-400" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
