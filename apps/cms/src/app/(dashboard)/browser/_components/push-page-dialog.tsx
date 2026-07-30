"use client";

import React, { useCallback, useEffect, useState } from "react";
import { X, Check, Loader2, MonitorPlay, AlertCircle, Info } from "lucide-react";
import { assignMedia } from "@/actions/screen-actions";
import { LiveControlDialog, type LiveScreen } from "@/app/(dashboard)/experiences/_components/live-control-dialog";
import { ControlChooserDialog } from "@/app/(dashboard)/experiences/_components/control-chooser-dialog";

interface ScreenOption {
  screenId: string;
  screenName: string;
  currentContentKind: string | null;
  currentMediaAssetId: string | null;
  mediaName: string | null;
  experienceName: string | null;
}

/** What a screen is showing now, so it's clear what a push would replace. */
function currentLabel(screen: ScreenOption): string {
  if (screen.currentContentKind === "experience" && screen.experienceName) {
    return screen.experienceName;
  }
  if (screen.currentContentKind === "media" && screen.mediaName) {
    return screen.mediaName;
  }
  return "Nothing assigned";
}

/**
 * Send whatever the Browser page is showing to one or more screens.
 *
 * Screens are pointed at media-library assets, not at raw URLs, so the page is
 * first registered as a link asset (the same row an "Add link" in the media
 * library creates) and that asset is then assigned. One asset, however many
 * screens — so they all show the same row rather than a duplicate each.
 *
 * That registration is created as pending-save: an ad-hoc push shouldn't
 * clutter the Media Library on its own. It's still fully playable/assignable
 * either way — pending-save only hides it from the library listing until the
 * admin explicitly keeps it via the "Save link" action in the control panel
 * that opens right after pushing.
 */
export function PushPageDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const [screens, setScreens] = useState<ScreenOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [activeScreenIds, setActiveScreenIds] = useState<Set<string>>(new Set());
  const [controlScreens, setControlScreens] = useState<LiveScreen[] | null>(null);
  const [chooserScreens, setChooserScreens] = useState<LiveScreen[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [screensRes, activeRes] = await Promise.all([
          fetch("/api/screens"),
          fetch("/api/screens/active"),
        ]);
        if (!screensRes.ok) throw new Error("Failed to load screens");
        const data = await screensRes.json();
        if (!cancelled) setScreens(data.screens ?? []);
        if (activeRes.ok) {
          const activeData = await activeRes.json();
          if (!cancelled) setActiveScreenIds(new Set(activeData.activeScreenIds ?? []));
        }
      } catch {
        if (!cancelled) setError("Could not load the screen list");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (screenId: string) =>
    setSelectedIds((prev) =>
      prev.includes(screenId) ? prev.filter((id) => id !== screenId) : [...prev, screenId]
    );

  const handlePush = useCallback(async () => {
    if (selectedIds.length === 0 || pushing) return;
    setPushing(true);
    setError(null);

    try {
      // Register the page once (pending-save — not shown in the Media Library
      // unless explicitly kept), then point every selected screen at that asset.
      const res = await fetch("/api/media/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, pendingSave: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "Could not push this page");

      const newMediaId = data.media.id as string;
      setMediaId(newMediaId);
      await Promise.all(selectedIds.map((screenId) => assignMedia(screenId, newMediaId)));

      const pushed: LiveScreen[] = screens
        .filter((s) => selectedIds.includes(s.screenId))
        .map((s) => ({ screenId: s.screenId, screenName: s.screenName, isOnline: activeScreenIds.has(s.screenId) }));
      // One screen: go straight to its control panel. Multiple: ask which
      // one to control first (control mirrors one screen at a time).
      if (pushed.length === 1) {
        setControlScreens(pushed);
      } else {
        setChooserScreens(pushed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to push to screen");
    } finally {
      setPushing(false);
    }
  }, [selectedIds, pushing, url, screens, activeScreenIds]);

  const handleSaveLink = useCallback(async () => {
    if (!mediaId) return;
    const res = await fetch(`/api/media/${mediaId}/save`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error ?? "Could not save this link");
  }, [mediaId]);

  let hostLabel = url;
  try {
    hostLabel = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* keep the raw string */
  }

  // Once pushed, swap straight into the control panel — the "Save link"
  // action there is the only way this page ends up in the Media Library.
  if (controlScreens) {
    return (
      <LiveControlDialog
        experienceName={hostLabel}
        screens={controlScreens}
        onSaveLink={handleSaveLink}
        onClose={onClose}
        webpage={mediaId ? { mediaId, url } : undefined}
      />
    );
  }
  if (chooserScreens) {
    return (
      <ControlChooserDialog
        contentName={hostLabel}
        screens={chooserScreens}
        onChoose={(screen) => setControlScreens([screen])}
        // Dismissing the chooser shouldn't discard the push — go back to
        // this push dialog, the previous step in the flow.
        onClose={() => setChooserScreens(null)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Push page to screen"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div
        className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.25em] text-zinc-400 dark:text-zinc-500">
              Push to Screen
            </p>
            <h2 className="truncate text-base font-bold uppercase tracking-wide text-zinc-900 dark:text-zinc-100">
              {hostLabel}
            </h2>
            <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400" title={url}>
              {url}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-xl bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-950 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {screens.length > 0 && (
          <p className="mb-4 flex items-start gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            The screen renders this page server-side too, so it shows exactly what you saw here —
            no extra setup needed on the display machine.
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading screens…
            </div>
          ) : screens.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <MonitorPlay className="h-6 w-6 text-zinc-400" />
              <p className="text-xs text-zinc-400 dark:text-zinc-600">
                No screens have been added yet. Add one from the Screens page.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {screens.map((screen) => {
                const isSelected = selectedIds.includes(screen.screenId);
                return (
                  <button
                    key={screen.screenId}
                    type="button"
                    onClick={() => toggle(screen.screenId)}
                    className={`relative flex flex-col items-start rounded-2xl border p-4 text-left transition-all duration-200 ${
                      isSelected
                        ? "border-zinc-900 bg-zinc-100 shadow-md dark:border-zinc-300 dark:bg-zinc-800/80"
                        : "border-zinc-200 bg-zinc-50/50 hover:border-zinc-400 hover:bg-zinc-100/50 dark:border-zinc-900 dark:bg-zinc-900/40 dark:hover:border-zinc-700"
                    }`}
                  >
                    <span className="w-full truncate text-sm font-bold leading-tight text-zinc-800 dark:text-zinc-200">
                      {screen.screenName}
                    </span>
                    <span
                      className="mt-0.5 w-full truncate text-[10px] text-zinc-400 dark:text-zinc-500"
                      title={currentLabel(screen)}
                    >
                      Now playing: {currentLabel(screen)}
                    </span>
                    {isSelected && (
                      <div className="absolute right-3 top-3 rounded-full bg-zinc-900 p-1 text-white dark:bg-zinc-100 dark:text-zinc-900">
                        <Check className="h-3 w-3 shrink-0" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        {screens.length > 0 && (
          <div className="mt-5 flex items-center justify-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-900">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePush}
              disabled={selectedIds.length === 0 || pushing}
              className="flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-wider text-zinc-100 transition-colors hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {pushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MonitorPlay className="h-3.5 w-3.5" />}
              {pushing ? "Pushing…" : `Push${selectedIds.length > 0 ? ` to ${selectedIds.length}` : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
