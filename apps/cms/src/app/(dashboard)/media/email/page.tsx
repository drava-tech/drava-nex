"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Mail, FileText, Image as ImageIcon, Video, FileSpreadsheet, Presentation, RefreshCw, Check, CheckSquare, MonitorPlay, X } from "lucide-react";
import { MediaPreviewModal, type MediaItem } from "../_components/media-preview-modal";
import { MediaQueuePushModal } from "../_components/media-queue-push-modal";

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
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [queueItems, setQueueItems] = useState<EmailMediaItem[] | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/media/gmail/list");
      if (res.ok) {
        const data = await res.json();
        setItems(data.media ?? []);
      }
    } catch (err) {
      console.error("Failed to load email media:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleLoad = async () => {
    setLoadingInbox(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/media/gmail/load", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "Could not load email");
      await fetchItems();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load email");
    } finally {
      setLoadingInbox(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((item) => item.id))
    );
  };

  const handleExitSelecting = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };

  // Selection order (Set insertion order) IS the queue order — the first
  // item clicked plays first. Pushing a queue doesn't remove items from this
  // list — every item here is already a permanent media asset, this view is
  // just filtered to gmail-sourced ones.
  const handlePushSelected = () => {
    const ordered = Array.from(selectedIds)
      .map((id) => items.find((item) => item.id === id))
      .filter((item): item is EmailMediaItem => Boolean(item));
    if (ordered.length > 0) setQueueItems(ordered);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-[#0a0a0a] min-h-[calc(100vh-4rem)]">
      <div className="flex flex-col gap-3 p-4 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] sticky top-0 z-20">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Email Media</h1>
            {/* <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Load the last 2 days of email attachments and links — they're saved straight to the Media Library, filtered here to just what came from email.
            </p> */}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => (selecting ? handleExitSelecting() : setSelecting(true))}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${selecting
                ? "border border-blue-600 bg-blue-50 text-blue-600 dark:border-blue-500 dark:bg-blue-500/10 dark:text-blue-400"
                : "border border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
                }`}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {selecting ? "Cancel" : "Select"}
            </button>
            <button
              type="button"
              onClick={handleLoad}
              disabled={loadingInbox}
              className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-100 transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingInbox ? "animate-spin" : ""}`} />
              {loadingInbox ? "Loading…" : "Load last 2 days"}
            </button>
          </div>
        </div>
        {loadError && (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">{loadError}</p>
        )}
      </div>

      {selecting && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a]">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{selectedIds.size} selected</p>
            <button
              onClick={handleSelectAll}
              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              {selectedIds.size === items.length && items.length > 0 ? "Deselect all" : "Select all"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePushSelected}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 h-9 px-4 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <MonitorPlay className="h-3.5 w-3.5" />
              {selectedIds.size ? `Push selected (${selectedIds.size})` : "Push selected"}
            </button>
            <button
              onClick={handleExitSelecting}
              className="flex items-center gap-1.5 h-9 px-3 rounded-full text-zinc-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 p-4 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-zinc-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-2">
            <Mail className="h-8 w-8 text-zinc-400 opacity-60" />
            <p className="text-sm font-semibold text-zinc-500 uppercase tracking-widest">No email media yet</p>
            <p className="text-xs text-zinc-400">Click "Load last 2 days" to pull in recent email attachments and links.</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4 lg:gap-6">
            {items.map((media) => {
              const isSelected = selectedIds.has(media.id);
              const selectionOrder = Array.from(selectedIds).indexOf(media.id) + 1;
              return (
                <div
                  key={media.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => (selecting ? toggleSelected(media.id) : setPreviewItem(media))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (selecting) toggleSelected(media.id);
                      else setPreviewItem(media);
                    }
                  }}
                  className={`group relative flex flex-col bg-white dark:bg-[#111] rounded-2xl border hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isSelected
                    ? "border-blue-500 ring-2 ring-blue-500/40"
                    : "border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20"
                    }`}
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
                    {selecting ? (
                      /* Selection badge — its own click target so it doesn't
                         double-toggle via the card's own onClick. Shows queue
                         order (selection order) once picked. */
                      <div
                        className="absolute top-3 left-3 z-10"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelected(media.id);
                        }}
                      >
                        <div
                          className={`flex items-center justify-center min-w-6 h-6 px-1 rounded-md border-2 backdrop-blur-md transition-colors text-xs font-bold ${isSelected
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "bg-black/30 border-white/70 hover:border-white text-transparent"
                            }`}
                        >
                          {isSelected ? selectionOrder : <Check className="w-4 h-4" />}
                        </div>
                      </div>
                    ) : null}
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
              );
            })}
          </div>
        )}
      </div>

      {previewItem && (
        <MediaPreviewModal media={previewItem} onClose={() => setPreviewItem(null)} />
      )}

      {queueItems && (
        <MediaQueuePushModal items={queueItems} onClose={() => setQueueItems(null)} />
      )}
    </div>
  );
}
