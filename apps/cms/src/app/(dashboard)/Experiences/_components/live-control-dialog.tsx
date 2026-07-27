"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { ScreenMirror } from "../../screens/_components/screen-mirror";

export interface LiveScreen {
  screenId: string;
  screenName: string;
  isOnline: boolean;
}

interface LiveControlDialogProps {
  experienceName: string;
  screens: LiveScreen[];
  onClose: () => void;
}

/**
 * Inline control for a live experience — reuses the same interactive
 * ScreenMirror as the full /screens/<id> control page, without navigating
 * away from the experiences dashboard. If the experience is live on more
 * than one screen, tabs switch which mirror is shown.
 */
export function LiveControlDialog({ experienceName, screens, onClose }: LiveControlDialogProps) {
  const [activeScreenId, setActiveScreenId] = useState(screens[0]?.screenId);
  const activeScreen = screens.find((s) => s.screenId === activeScreenId) ?? screens[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 select-none"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" />

      <div
        className="relative w-full max-w-4xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-t-3xl md:rounded-3xl p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden transition-all transform scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4 gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase mb-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  activeScreen?.isOnline ? "bg-green-500 shadow-[0_0_6px_#22c55e] animate-pulse" : "bg-zinc-400"
                }`}
              />
              {activeScreen?.isOnline ? "Live" : "Offline"} · {experienceName}
            </p>
            {screens.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {screens.map((s) => (
                  <button
                    key={s.screenId}
                    type="button"
                    onClick={() => setActiveScreenId(s.screenId)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      s.screenId === activeScreen?.screenId
                        ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                        : "bg-zinc-100 dark:bg-zinc-900 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${s.isOnline ? "bg-green-500" : "bg-zinc-400"}`} />
                    {s.screenName}
                  </button>
                ))}
              </div>
            ) : (
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase truncate">
                {activeScreen?.screenName}
              </h2>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!activeScreen?.isOnline && (
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            This screen is offline — showing its last known state. Touch won't reach the TV until it reconnects.
          </p>
        )}

        {/* Interactive mirror — touch relays to the TV in realtime */}
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="relative w-full aspect-[16/9] max-h-full rounded-2xl border-[6px] border-zinc-800 dark:border-zinc-900 shadow-2xl bg-zinc-950 overflow-hidden">
            {activeScreen && (
              <ScreenMirror screenId={activeScreen.screenId} title={activeScreen.screenName} interactive />
            )}
          </div>
        </div>
        <p className="mt-3 text-center text-[10px] text-zinc-400 dark:text-zinc-600 font-medium">
          Touch to explore — mirrored on the TV in realtime
        </p>
      </div>
    </div>
  );
}
