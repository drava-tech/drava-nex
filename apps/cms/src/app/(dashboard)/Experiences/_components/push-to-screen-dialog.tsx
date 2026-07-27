"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Check, Loader2, MonitorPlay } from "lucide-react";
import { assignExperience } from "@/actions/screen-actions";

export interface ScreenRow {
  screenId: string;
  screenName: string;
  currentContentKind: string | null;
  currentExperienceId: string | null;
  experienceName: string | null;
  currentMediaAssetId: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  mediaName: string | null;
}

interface PushToScreenDialogProps {
  experienceName: string;
  experienceId: string;
  screens: ScreenRow[];
  activeScreenIds: Set<string>;
  onClose: () => void;
  onPushed?: (screenIds: string[]) => void;
}

/** Label for whatever a screen is currently showing, so admins know what they'd overwrite. */
function currentLabel(screen: ScreenRow): string {
  if (screen.currentContentKind === "experience" && screen.experienceName) {
    return screen.experienceName;
  }
  if (screen.currentContentKind === "media" && screen.mediaName) {
    return screen.mediaName;
  }
  return "Nothing assigned";
}

export function PushToScreenDialog({
  experienceName,
  experienceId,
  screens,
  activeScreenIds,
  onClose,
  onPushed,
}: PushToScreenDialogProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const onlineCount = screens.filter((s) => activeScreenIds.has(s.screenId)).length;

  const toggleScreen = (screenId: string) =>
    setSelectedIds((prev) =>
      prev.includes(screenId) ? prev.filter((id) => id !== screenId) : [...prev, screenId]
    );

  const handlePush = () => {
    if (selectedIds.length === 0) return;
    startTransition(async () => {
      await Promise.all(selectedIds.map((screenId) => assignExperience(screenId, experienceId)));
      router.refresh();
      if (onPushed) {
        onPushed(selectedIds);
      } else {
        onClose();
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 select-none"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" />

      {/* Dialog Panel */}
      <div
        className="relative w-full max-w-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-t-3xl md:rounded-3xl p-6 shadow-2xl flex flex-col max-h-[85vh] md:max-h-[80vh] overflow-hidden transition-all transform scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase mb-0.5">
              Push to Screen
            </p>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase">
              {experienceName}
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {screens.length === 0
                ? "No screens available"
                : `${screens.length} screen${screens.length === 1 ? "" : "s"} available · ${onlineCount} online`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Screen list */}
        <div className="flex-1 overflow-y-auto pr-1">
          {screens.length === 0 ? (
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
                const isSelected = selectedIds.includes(screen.screenId);
                return (
                  <button
                    key={screen.screenId}
                    type="button"
                    onClick={() => toggleScreen(screen.screenId)}
                    className={`relative flex flex-col items-start rounded-2xl border p-4 text-left transition-all duration-200
                      ${
                        isSelected
                          ? "border-zinc-900 dark:border-zinc-300 bg-zinc-100 dark:bg-zinc-800/80 shadow-md"
                          : "border-zinc-200 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/40 hover:border-zinc-400 dark:hover:border-zinc-700 hover:bg-zinc-100/50 dark:hover:bg-zinc-850/50"
                      }`}
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
                    <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200 leading-tight truncate w-full">
                      {screen.screenName}
                    </span>
                    <span className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500 truncate w-full">
                      Now playing: {currentLabel(screen)}
                    </span>
                    {isSelected && (
                      <div className="absolute top-3 right-3 p-1 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900">
                        <Check className="h-3 w-3 shrink-0" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {screens.length > 0 && (
          <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-900">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold tracking-wider uppercase text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePush}
              disabled={selectedIds.length === 0 || isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-300 dark:text-zinc-900 text-zinc-100 text-xs font-bold tracking-wider uppercase transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MonitorPlay className="h-3.5 w-3.5" />}
              {isPending
                ? "Pushing…"
                : `Push${selectedIds.length > 0 ? ` to ${selectedIds.length}` : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
