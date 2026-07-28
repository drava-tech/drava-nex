"use client";

import { useEffect, useState } from "react";
import { X, Loader2, MonitorPlay, Cast } from "lucide-react";
import { getScreens, getActiveScreens } from "@/actions/screen-actions";

interface ScreenRow {
  screenId: string;
  screenName: string;
  currentContentKind: string | null;
  experienceName: string | null;
  mediaName: string | null;
}

interface PushWhiteboardDialogProps {
  /** Snapshot of the current board, taken when the dialog opened — a preview of what you're about to start pushing. Null when opened before any drawing exists yet. */
  previewDataUrl: string | null;
  onClose: () => void;
  onSelect: (screenId: string, screenName: string, isOnline: boolean) => void;
  /** Lets the operator open the board without pushing anywhere (local sketch only). Omit to require a screen. */
  onSkip?: () => void;
}

function currentLabel(screen: ScreenRow): string {
  if (screen.currentContentKind === "experience" && screen.experienceName) return screen.experienceName;
  if (screen.currentContentKind === "media" && screen.mediaName) return screen.mediaName;
  return "Nothing assigned";
}

/** Confirm step before starting a live whiteboard push: see the current drawing, then pick a screen. */
export function PushWhiteboardDialog({ previewDataUrl, onClose, onSelect, onSkip }: PushWhiteboardDialogProps) {
  const [screens, setScreens] = useState<ScreenRow[]>([]);
  const [activeScreenIds, setActiveScreenIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getScreens(), getActiveScreens()])
      .then(([screenRows, activeIds]) => {
        setScreens(screenRows);
        setActiveScreenIds(new Set(activeIds));
      })
      .catch((err) => console.error("Failed to load screens in push-whiteboard dialog:", err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end md:items-center justify-center p-0 md:p-4 select-none"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" />

      <div
        className="relative w-full max-w-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-t-3xl md:rounded-3xl p-6 shadow-2xl flex flex-col max-h-[85vh] md:max-h-[80vh] overflow-hidden transition-all transform scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase mb-0.5">
              Live Whiteboard
            </p>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase">
              {previewDataUrl ? "Pick a Screen" : "Which Screen Should This Replicate To?"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {previewDataUrl && (
          <div className="mb-4 rounded-2xl border border-zinc-200 dark:border-zinc-900 overflow-hidden bg-zinc-50 dark:bg-zinc-900/40">
            <img src={previewDataUrl} alt="Whiteboard preview" className="w-full max-h-40 object-contain" />
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 border-t border-zinc-200 dark:border-zinc-900">
              What you're about to push — it'll keep updating live as you keep drawing
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-400 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
              <p className="text-xs">Loading screens...</p>
            </div>
          ) : screens.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <MonitorPlay className="h-6 w-6 text-zinc-400" />
              <p className="text-xs text-zinc-400 dark:text-zinc-600">
                No screens have been added yet. Add one from the Screens page.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {screens.map((screen) => {
                const isOnline = activeScreenIds.has(screen.screenId);
                return (
                  <button
                    key={screen.screenId}
                    type="button"
                    onClick={() => onSelect(screen.screenId, screen.screenName, isOnline)}
                    className="relative flex flex-col items-start rounded-2xl border p-4 text-left transition-all duration-200 border-zinc-200 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/40 hover:border-zinc-400 dark:hover:border-zinc-700 hover:bg-zinc-100/50 dark:hover:bg-zinc-850/50"
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isOnline ? "bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" : "bg-zinc-400"
                        }`}
                      />
                      <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.2em] uppercase">
                        {isOnline ? "Online" : "Offline"}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200 leading-tight truncate w-full flex items-center gap-1.5">
                      <Cast className="h-3.5 w-3.5 shrink-0" /> {screen.screenName}
                    </span>
                    <span className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500 truncate w-full">
                      Now playing: {currentLabel(screen)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {onSkip && (
          <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-900 flex justify-end">
            <button
              type="button"
              onClick={onSkip}
              className="px-4 py-2 rounded-xl text-xs font-bold tracking-wider uppercase text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              Draw without pushing
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
