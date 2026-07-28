"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Check, Loader2, MonitorPlay } from "lucide-react";
import { assignExperience } from "@/actions/screen-actions";
import { LiveControlDialog, type LiveScreen } from "./live-control-dialog";
import { ControlChooserDialog } from "./control-chooser-dialog";
import type { ScreenRow } from "./push-to-screen-dialog";

interface ExperiencePreviewModalProps {
  experienceId: string;
  experienceName: string;
  slug: string;
  templateKey: string | null;
  screens: ScreenRow[];
  activeScreenIds: Set<string>;
  onClose: () => void;
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

/**
 * Preview an experience and, once you've seen it, push it to one or more
 * screens. Combines the old separate push dialog + control dialog into one
 * flow: preview first, then screens (with online/offline counts), then push,
 * then straight into the same live control panel Media uses.
 */
export function ExperiencePreviewModal({
  experienceId,
  experienceName,
  slug,
  templateKey,
  screens,
  activeScreenIds,
  onClose,
}: ExperiencePreviewModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [controlScreens, setControlScreens] = useState<LiveScreen[] | null>(null);
  const [chooserScreens, setChooserScreens] = useState<LiveScreen[] | null>(null);

  // Pre-select whichever screens are already showing this experience, so the
  // modal reflects current live state on open.
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    screens
      .filter((s) => s.currentContentKind === "experience" && s.currentExperienceId === experienceId)
      .map((s) => s.screenId)
  );

  const onlineCount = screens.filter((s) => activeScreenIds.has(s.screenId)).length;
  const offlineCount = screens.length - onlineCount;

  // Every screen in the system, for LiveControlDialog's "switch screen" dropdown.
  const allScreensForControl: LiveScreen[] = screens.map((s) => ({
    screenId: s.screenId,
    screenName: s.screenName,
    isOnline: activeScreenIds.has(s.screenId),
  }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const toggleScreen = (screenId: string) =>
    setSelectedIds((prev) =>
      prev.includes(screenId) ? prev.filter((id) => id !== screenId) : [...prev, screenId]
    );

  const handlePush = () => {
    if (selectedIds.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const targets = screens.filter((s) => selectedIds.includes(s.screenId));
        // Screens already showing this exact experience don't need re-pushing —
        // that would just reset them from the start for no reason.
        const needsPush = targets.filter(
          (s) => !(s.currentContentKind === "experience" && s.currentExperienceId === experienceId)
        );
        await Promise.all(needsPush.map((s) => assignExperience(s.screenId, experienceId)));
        if (needsPush.length > 0) router.refresh();

        const pushed: LiveScreen[] = targets.map((s) => ({
          screenId: s.screenId,
          screenName: s.screenName,
          isOnline: activeScreenIds.has(s.screenId),
        }));
        // One screen: go straight to its control panel. Multiple: ask which
        // one to control first (control mirrors one screen at a time).
        if (pushed.length === 1) {
          setControlScreens(pushed);
        } else {
          setChooserScreens(pushed);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to push to screen");
      }
    });
  };

  // Once pushed, swap straight into the same live control panel Media uses —
  // no need to keep the preview open behind it.
  if (controlScreens) {
    return (
      <LiveControlDialog
        experienceName={experienceName}
        screens={controlScreens}
        allScreens={allScreensForControl}
        onClose={onClose}
      />
    );
  }
  if (chooserScreens) {
    return (
      <ControlChooserDialog
        contentName={experienceName}
        screens={chooserScreens}
        onChoose={(screen) => setControlScreens([screen])}
        // Dismissing the chooser shouldn't close the whole preview — go back
        // to the preview + screen-select pane instead.
        onClose={() => setChooserScreens(null)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${experienceName}`}
    >
      <div
        className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0f0f0f] lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Preview pane */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-zinc-950">
          {templateKey ? (
            <iframe
              key={slug}
              src={`/preview/experiences/${slug}`}
              title={experienceName}
              className="h-full w-full border-0 bg-black"
              sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
              allow="autoplay; encrypted-media; fullscreen"
            />
          ) : (
            <p className="px-8 text-center text-sm text-white/50">No template assigned to this experience.</p>
          )}
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-colors hover:bg-black/70 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Screens + push pane */}
        <div className="flex w-full shrink-0 flex-col border-t border-zinc-200 dark:border-white/10 lg:w-96 lg:border-l lg:border-t-0">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-5 dark:border-white/10">
            <div className="min-w-0">
              <h2
                className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50"
                title={experienceName}
              >
                {experienceName}
              </h2>
              <p className="mt-1 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_6px_#22c55e]" />
                  {onlineCount} online
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                  {offlineCount} offline
                </span>
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close preview"
              className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white lg:flex"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 px-5 pb-2 pt-4">
              <MonitorPlay className="h-3.5 w-3.5 text-zinc-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Push to screen
              </h3>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
              {screens.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-zinc-400">No screens registered yet</p>
              ) : (
                <div className="space-y-1">
                  {screens.map((screen) => {
                    const isOnline = activeScreenIds.has(screen.screenId);
                    const isSelected = selectedIds.includes(screen.screenId);
                    return (
                      <button
                        key={screen.screenId}
                        type="button"
                        onClick={() => toggleScreen(screen.screenId)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                          isSelected
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/5"
                        }`}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              isOnline ? "bg-green-500 shadow-[0_0_6px_#22c55e]" : "bg-zinc-400"
                            }`}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            <span className="block truncate font-medium">{screen.screenName}</span>
                            <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">
                              {currentLabel(screen)}
                            </span>
                          </span>
                        </span>
                        {isSelected && <Check className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {error && (
              <p className="mx-5 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2 border-t border-zinc-200 p-4 dark:border-white/10">
              <button
                onClick={handlePush}
                disabled={selectedIds.length === 0 || isPending || screens.length === 0}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-blue-600 text-sm font-medium text-white transition-all hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/25 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Pushing…
                  </>
                ) : (
                  <>
                    <MonitorPlay className="h-4 w-4" />
                    {selectedIds.length > 0 ? `Push to ${selectedIds.length}` : "Select a screen"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
