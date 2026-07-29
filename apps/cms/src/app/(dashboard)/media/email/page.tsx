"use client";

import React, { useEffect, useState } from "react";
import { Mail, FileText, Image as ImageIcon, Video, FileSpreadsheet, Presentation } from "lucide-react";
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
  const [previewItem, setPreviewItem] = useState<EmailMediaItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/media?source=gmail");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setItems(data.media ?? []);
        }
      } catch (err) {
        console.error("Failed to load email media:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-[#0a0a0a] min-h-[calc(100vh-4rem)]">
      <div className="flex flex-col gap-1 p-6 lg:px-8 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] sticky top-0 z-20">
        <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Email Media</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Attachments automatically pulled in from incoming email</p>
      </div>

      <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-zinc-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-2">
            <Mail className="h-8 w-8 text-zinc-400 opacity-60" />
            <p className="text-sm font-semibold text-zinc-500 uppercase tracking-widest">No email attachments yet</p>
            <p className="text-xs text-zinc-400">Anything emailed in with a supported attachment will show up here.</p>
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
