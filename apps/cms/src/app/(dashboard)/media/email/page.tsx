"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Mail, FileText, Image as ImageIcon, Video, FileSpreadsheet, Presentation, RefreshCw, Trash2, Check } from "lucide-react";
import { MediaPreviewModal, type MediaItem } from "../_components/media-preview-modal";

interface EmailMediaItem extends MediaItem {
  emailFrom: string | null;
  emailSubject: string | null;
}

/** Small icon for a media kind, used in the type badge on each card. */
function TypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon =
    type === "video" ? Video
    : type === "image" ? ImageIcon
    : type === "sheet" ? FileSpreadsheet
    : type === "presentation" ? Presentation
    : FileText;
  return <Icon className={className} />;
}

/** Parses a "Display Name <addr@domain>" From header down to just the display name (or the raw address if there's no display name). */
function senderLabel(from: string | null): string {
  if (!from) return "Unknown sender";
  const match = from.match(/^"?([^"<]*)"?\s*<[^>]+>$/);
  const name = match?.[1]?.trim();
  return name || from;
}

export default function EmailMediaPage() {
  const [items, setItems] = useState<EmailMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<EmailMediaItem | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch("/api/media/gmail/pending");
      if (res.ok) {
        const data = await res.json();
        setItems(data.media ?? []);
      }
    } catch (err) {
      console.error("Failed to load pending email media:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const handleLoad = async () => {
    setLoadingInbox(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/media/gmail/load", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "Could not load email");
      await fetchPending();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load email");
    } finally {
      setLoadingInbox(false);
    }
  };

  const handleDiscard = async (id: string) => {
    try {
      const res = await fetch(`/api/media?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        setPreviewItem((current) => (current?.id === id ? null : current));
      }
    } catch (err) {
      console.error("Failed to discard email media:", err);
    }
  };

  // Keeps the item — moves it out of this temporary queue and into the
  // regular Media Library, with no need to push it to a screen first (unlike
  // MediaPreviewModal's push-then-"Save link" flow, which exists for the
  // Browser tool's different "I already pushed this, keep it" use case).
  const handleKeep = async (id: string) => {
    try {
      const res = await fetch(`/api/media/${id}/save`, { method: "POST" });
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        setPreviewItem((current) => (current?.id === id ? null : current));
      }
    } catch (err) {
      console.error("Failed to keep email media:", err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-[#0a0a0a] min-h-[calc(100vh-4rem)]">
      <div className="flex flex-col gap-3 p-6 lg:px-8 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] sticky top-0 z-20">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Email Media</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Load the last 2 days of email attachments and links to review before keeping — nothing here is permanent until you save it.
            </p>
          </div>
          <button
            type="button"
            onClick={handleLoad}
            disabled={loadingInbox}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-100 transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingInbox ? "animate-spin" : ""}`} />
            {loadingInbox ? "Loading…" : "Load last 2 days"}
          </button>
        </div>
        {loadError && (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">{loadError}</p>
        )}
      </div>

      <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-zinc-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-2">
            <Mail className="h-8 w-8 text-zinc-400 opacity-60" />
            <p className="text-sm font-semibold text-zinc-500 uppercase tracking-widest">Nothing pending</p>
            <p className="text-xs text-zinc-400">Click "Load last 2 days" to pull in recent email attachments and links.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 lg:gap-6">
            {items.map((media) => (
              <div
                key={media.id}
                role="button"
                tabIndex={0}
                onClick={() => setPreviewItem(media)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPreviewItem(media);
                  }
                }}
                className="group relative flex flex-col bg-white dark:bg-[#111] rounded-2xl border border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <div className="aspect-video w-full overflow-hidden rounded-t-2xl bg-zinc-100 dark:bg-zinc-800/50 relative flex items-center justify-center">
                  {media.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={media.url} alt={media.name} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <TypeIcon type={media.type} className="w-16 h-16 text-zinc-300 dark:text-zinc-600" />
                  )}
                  <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md text-white text-[10px] font-medium tracking-wide uppercase">
                    <Mail className="w-3 h-3" />
                    {media.type}
                  </div>
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      title="Keep"
                      aria-label="Keep"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleKeep(media.id);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-green-600/80"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Discard"
                      aria-label="Discard"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDiscard(media.id);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-red-600/80"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="p-4 flex flex-col gap-1">
                  <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate" title={media.name}>
                    {media.name}
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate" title={media.emailFrom ?? undefined}>
                    From {senderLabel(media.emailFrom)}
                  </p>
                  {media.emailSubject && (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate" title={media.emailSubject}>
                      &ldquo;{media.emailSubject}&rdquo;
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">{media.size}</p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">{media.date}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {previewItem && (
        <MediaPreviewModal media={previewItem} onClose={() => setPreviewItem(null)} />
      )}
    </div>
  );
}
