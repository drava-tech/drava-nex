"use client";

import { X, Wifi, WifiOff, Layers } from "lucide-react";
import { ScreenMirror } from "./screen-mirror";

interface ScreenControlModalProps {
  screenId: string;
  screenName: string;
  isOnline: boolean;
  onChangeContent: () => void;
  onClose: () => void;
}

/**
 * Full-size, interactive mirror of a screen. You touch/click the content here and
 * the interaction is relayed (via the screens player's WS) to every client of the
 * screen — so the TV shows the exact same page in realtime, and vice versa.
 */
export function ScreenControlModal({
  screenId,
  screenName,
  isOnline,
  onChangeContent,
  onClose,
}: ScreenControlModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      <div
        className="relative w-full h-full md:h-auto md:max-w-6xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 md:rounded-3xl p-4 md:p-5 shadow-2xl flex flex-col gap-4 max-h-screen md:max-h-[94vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                isOnline
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-zinc-500/10 text-zinc-500"
              }`}
            >
              {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {isOnline ? "Online" : "Offline"}
            </span>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase leading-none">
              {screenName}
            </h2>
            <span className="hidden sm:inline text-[10px] text-zinc-400 dark:text-zinc-600 font-medium">
              · touch to explore — mirrored on the TV in realtime
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onChangeContent}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-[10px] font-bold uppercase tracking-wider transition-colors"
            >
              <Layers className="h-3.5 w-3.5" /> Change
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Big interactive screen */}
        <div className="flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden">
          <div className="relative w-full aspect-[16/9] max-h-full rounded-2xl border-[5px] border-zinc-800 dark:border-zinc-900 shadow-xl bg-zinc-950 overflow-hidden">
            <ScreenMirror screenId={screenId} title={`${screenName} (control)`} interactive />
          </div>
        </div>
      </div>
    </div>
  );
}
