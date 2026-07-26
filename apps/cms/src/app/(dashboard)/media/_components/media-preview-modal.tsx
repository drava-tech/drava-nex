"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  X,
  Cast,
  Check,
  Loader2,
  Monitor,
  ExternalLink,
  Download,
  AlertCircle,
} from "lucide-react";
import { mediaEmbedUrl, isLinkMediaType } from "@platform/types";
import { assignMedia } from "@/actions/screen-actions";

export interface MediaItem {
  id: string;
  name: string;
  type: string;
  url: string;
  size: string;
  date: string;
}

interface ScreenOption {
  screenId: string;
  screenName: string;
  currentMediaAssetId: string | null;
}

/**
 * Preview a media asset and, once you've seen it, push it to a screen. The
 * preview renders through the SAME embed resolver the screens use
 * (mediaEmbedUrl), so what you approve here is literally what goes on the wall
 * — that's the point of gating the push behind the preview.
 */
export function MediaPreviewModal({
  media,
  onClose,
}: {
  media: MediaItem;
  onClose: () => void;
}) {
  const [screens, setScreens] = useState<ScreenOption[]>([]);
  const [loadingScreens, setLoadingScreens] = useState(true);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushedTo, setPushedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape, and stop the page behind from scrolling under the modal.
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/screens");
        if (!res.ok) throw new Error("Failed to load screens");
        const data = await res.json();
        if (!cancelled) setScreens(data.screens ?? []);
      } catch {
        if (!cancelled) setError("Could not load the screen list");
      } finally {
        if (!cancelled) setLoadingScreens(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePush = useCallback(async () => {
    if (!selectedScreenId) return;
    setPushing(true);
    setError(null);
    try {
      await assignMedia(selectedScreenId, media.id);
      setPushedTo(selectedScreenId);
      // Refresh the list so "Now playing" badges reflect the push.
      setScreens((prev) =>
        prev.map((s) =>
          s.screenId === selectedScreenId ? { ...s, currentMediaAssetId: media.id } : s
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to push to screen");
    } finally {
      setPushing(false);
    }
  }, [selectedScreenId, media.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${media.name}`}
    >
      <div
        className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0f0f0f] lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Preview pane */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-zinc-950">
          <MediaPreviewSurface media={media} />
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-colors hover:bg-black/70 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Details + push pane */}
        <div className="flex w-full shrink-0 flex-col border-t border-zinc-200 dark:border-white/10 lg:w-96 lg:border-l lg:border-t-0">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-5 dark:border-white/10">
            <div className="min-w-0">
              <h2
                className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50"
                title={media.name}
              >
                {media.name}
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="uppercase tracking-wide">{media.type}</span>
                {media.size !== "—" && <> · {media.size}</>} · {media.date}
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

          {/* Screen picker */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 px-5 pb-2 pt-4">
              <Monitor className="h-3.5 w-3.5 text-zinc-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Push to screen
              </h3>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
              {loadingScreens ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading screens…
                </div>
              ) : screens.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-zinc-400">No screens registered yet</p>
              ) : (
                <div className="space-y-1">
                  {screens.map((screen) => {
                    const isSelected = selectedScreenId === screen.screenId;
                    const isPlaying = screen.currentMediaAssetId === media.id;
                    return (
                      <button
                        key={screen.screenId}
                        onClick={() => {
                          setSelectedScreenId(screen.screenId);
                          setPushedTo(null);
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                          isSelected
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/5"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{screen.screenName}</span>
                        {isPlaying && (
                          <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-700 dark:bg-green-500/15 dark:text-green-400">
                            Now playing
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {error && (
              <p className="mx-5 mb-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2 border-t border-zinc-200 p-4 dark:border-white/10">
              <button
                onClick={handlePush}
                disabled={!selectedScreenId || pushing}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-full text-sm font-medium transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
                  pushedTo && pushedTo === selectedScreenId
                    ? "bg-green-600 text-white"
                    : "bg-blue-600 text-white hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/25"
                }`}
              >
                {pushing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Pushing…
                  </>
                ) : pushedTo && pushedTo === selectedScreenId ? (
                  <>
                    <Check className="h-4 w-4" /> Pushed to screen
                  </>
                ) : (
                  <>
                    <Cast className="h-4 w-4" />
                    {selectedScreenId ? "Push to screen" : "Select a screen"}
                  </>
                )}
              </button>

              <div className="flex gap-2">
                <a
                  href={media.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-zinc-200 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
                {!isLinkMediaType(media.type) && (
                  <a
                    href={media.url}
                    download={media.name}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-zinc-200 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Renders the asset itself, using the same embed URL a screen would load. */
function MediaPreviewSurface({ media }: { media: MediaItem }) {
  if (media.type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={media.url} alt={media.name} className="max-h-full max-w-full object-contain" />
    );
  }

  if (media.type === "video") {
    return (
      <video src={media.url} controls playsInline className="max-h-full max-w-full" />
    );
  }

  // Everything else renders as an embedded page — kiosk mode off, so the
  // preview keeps its controls and doesn't autoplay at whoever's watching.
  return (
    <iframe
      key={media.url}
      src={mediaEmbedUrl(media.type, media.url)}
      title={media.name}
      className="h-full w-full border-0 bg-white"
      sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
      allow="autoplay; encrypted-media; fullscreen"
    />
  );
}
