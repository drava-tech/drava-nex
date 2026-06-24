"use client";

import React, { useEffect, useRef, useState } from "react";
import { X, Upload, Loader2, ImageIcon } from "lucide-react";

interface MediaItem {
  id: string;
  name: string;
  type: string;
  url: string;
}

/**
 * Shopify-style media picker modal: browse the media library (GET /api/media),
 * upload a new file (POST /api/upload), and pick one. Calls onSelect with the URL.
 */
export function MediaPicker({
  open,
  onClose,
  onSelect,
  accept = "image",
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
  accept?: "image" | "video" | "all";
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/media")
      .then((r) => r.json())
      .then((d) => setItems(d.media ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const visible = accept === "all" ? items : items.filter((i) => i.type === accept);
  const uploadAccept = accept === "video" ? "video/*" : accept === "all" ? "image/*,video/*" : "image/*";

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.success && data.media) setItems((prev) => [data.media, ...prev]);
    } catch {
      /* ignore */
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-3xl max-h-[80vh] flex flex-col bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Select media</h2>
          <div className="flex items-center gap-2">
            <input type="file" ref={fileRef} className="hidden" accept={uploadAccept} onChange={upload} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs font-semibold disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400 text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading media…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2 text-zinc-400">
              <ImageIcon className="h-8 w-8 opacity-60" />
              <p className="text-sm">No media yet — click Upload to add one.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {visible.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onSelect(m.url);
                    onClose();
                  }}
                  className="group relative aspect-video rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 hover:border-zinc-900 dark:hover:border-zinc-300 hover:ring-2 hover:ring-zinc-900/10 transition-all"
                  title={m.name}
                >
                  {m.type === "video" ? (
                    <video src={m.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={m.name} className="w-full h-full object-cover" loading="lazy" />
                  )}
                  <span className="absolute bottom-0 inset-x-0 px-2 py-1 text-[10px] text-white bg-black/50 truncate text-left">
                    {m.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
