"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, AlertTriangle, RotateCw } from "lucide-react";
import { mediaEmbedUrl, isPageMediaType, documentKindOfMediaType } from "@platform/types";
import { assignMedia } from "@/actions/screen-actions";
import { PushToScreenModal, type ScreenRow } from "@/components/push-to-screen-modal";

export interface MediaItem {
  id: string;
  name: string;
  type: string;
  url: string;
  size: string;
  /** Locale-formatted for display (e.g. "Aug 12, 2026") — see `createdAt`
   * below for a comparable value. */
  date: string;
  /** Raw ISO timestamp — for date-range filtering, which can't reliably
   * parse the locale-formatted `date` string above. */
  createdAt?: string;
  /** Where this asset came from — 'upload' | 'email' | 'link'. See
   * packages/db/src/schema/media.ts. */
  source?: string | null;
  /** True for a not-yet-kept link (Add Link) — hidden from the Media Library
   * listing until explicitly saved. Only present on items just created via
   * that flow; ordinary already-listed items omit it (falsy). */
  pendingSave?: boolean;
}

/**
 * Preview a media asset and, once you've seen it, push it to a screen. The
 * preview renders through the SAME embed resolver the screens use
 * (mediaEmbedUrl), so what you approve here is literally what goes on the wall
 * — that's the point of gating the push behind the preview. Screen selection,
 * push, and the control panel are all the shared PushToScreenModal — only the
 * media-specific preview/metadata/Open/Download live here.
 */
export function MediaPreviewModal({
  media,
  onClose,
}: {
  media: MediaItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const showTouchpad = isPageMediaType(media.type);

  const handleSaveLink = async () => {
    const res = await fetch(`/api/media/${media.id}/save`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error ?? "Could not save this link");
  };

  return (
    <PushToScreenModal
      contentName={media.name}
      onClose={onClose}
      preview={<MediaPreviewSurface media={media} />}
      subtitle={
        <>
          <span className="uppercase tracking-wide">{media.type}</span>
          {media.size !== "—" && <> · {media.size}</>} · {media.date}
        </>
      }
      onPush={(screenId) => assignMedia(screenId, media.id)}
      isAlreadyShowing={(s: ScreenRow) => s.currentMediaAssetId === media.id}
      // Only a not-yet-saved link has anything to save — an ordinary already-
      // listed item (upload, or a link kept earlier) shouldn't show the button.
      onSaveLink={media.pendingSave ? handleSaveLink : undefined}
      showTouchpad={showTouchpad}
      documentKind={documentKindOfMediaType(media.type)}
      // Page-type content (link/YouTube/Drive/PDF/sheet/deck) hands off to the
      // routed touchpad at /browser/live/[deviceId] instead of swapping in
      // the in-popup LiveControlDialog — one touchpad surface, not two. Other
      // content (images/videos) keeps the default swap-to-mirror behavior.
      onPushed={
        showTouchpad
          ? (pushed) => {
              const target = pushed.find((s) => s.isOnline) ?? pushed[0];
              onClose();
              if (target) router.push(`/browser/live/${target.screenId}`);
            }
          : undefined
      }
    />
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

  // Everything else (including generic web links) renders as an embedded
  // iframe, using the exact same URL a screen would load — kiosk mode off,
  // so the preview keeps its controls and doesn't autoplay at whoever's
  // watching. See EmbedSurface's isWebPage handling for the "site refuses
  // to embed" fallback that generic links can hit.
  return <EmbedSurface media={media} />;
}

/** Sites that refuse embedding give no signal, so fall back on time. */
const BLOCKED_HINT_MS = 4000;

/**
 * Set on <html> by the Frame Unlock extension's content script (see
 * tools/frame-unlock-extension). Without it, sites that send X-Frame-Options
 * won't render and there is nothing this page can do about it.
 */
const EXTENSION_MARKER = "data-cms-frame-unlock";

/**
 * A live, fully interactive embed of the asset — click, type, scroll, submit
 * forms, follow links. The sandbox grants everything a real page needs
 * (matching the Browser page); it stays a sandbox only so a framed site can't
 * navigate the CMS out from under itself.
 *
 * Reload is a key remount rather than a contentWindow call: the frame is
 * cross-origin, so we can't reach into it, and re-keying is the one thing that
 * reliably works for every kind of embed.
 */
function EmbedSurface({ media }: { media: MediaItem }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [maybeBlocked, setMaybeBlocked] = useState(false);
  const [hasExtension, setHasExtension] = useState(true);

  const src = mediaEmbedUrl(media.type, media.url);
  // Only arbitrary web pages hit framing headers — YouTube, Drive and our own
  // viewers all publish embeds built to be framed.
  const isWebPage = media.type === "link";
  // Checked after mount so SSR markup and the first client render agree.
  useEffect(() => {
    setHasExtension(document.documentElement.hasAttribute(EXTENSION_MARKER));
  }, []);

  useEffect(() => {
    setMaybeBlocked(false);
    const timer = setTimeout(() => setMaybeBlocked(true), BLOCKED_HINT_MS);
    return () => clearTimeout(timer);
  }, [src, reloadKey]);

  return (
    <div className="group/embed relative h-full w-full">
      <iframe
        key={`${src}-${reloadKey}`}
        src={src}
        title={media.name}
        onLoad={() => setMaybeBlocked(false)}
        className="h-full w-full border-0 bg-black"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation"
        allow="autoplay; encrypted-media; fullscreen; clipboard-write"
      />

      {/* Reload sits over the frame and out of the way until pointed at, so it
          doesn't cover the top-left of whatever page is loaded. */}
      <button
        type="button"
        onClick={() => setReloadKey((k) => k + 1)}
        title="Reload"
        aria-label="Reload"
        className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-md transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover/embed:opacity-100"
      >
        <RotateCw className="h-4 w-4" />
      </button>

      {isWebPage && maybeBlocked && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
          <div className="pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl border border-border bg-white/95 px-4 py-3 shadow-lg backdrop-blur dark:bg-[#111]/95">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0 text-xs">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">Nothing rendered yet</p>
              <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                {hasExtension
                  ? "A few sites bounce out of frames in JavaScript, which no extension can stop. Opening it in a new tab always works."
                  : "This site refuses to be embedded. Install the Frame Unlock extension (tools/frame-unlock-extension) on this machine, or open it in a new tab."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.open(media.url, "_blank", "noopener,noreferrer")}
              className="ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full btn-primary px-3 text-xs font-normal transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
