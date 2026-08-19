"use client";

import React, { useEffect, useRef, useState } from "react";
import { X, Upload, Loader2, ImageIcon } from "lucide-react";

interface MediaItem {
  id: string;
  name: string;
  type: string;
  url: string;
}

export interface MediaPickerItem {
  id: string;
  name: string;
  type: string;
  url: string;
}

/**
 * Shopify-style media picker modal: browse the media library (GET /api/media),
 * upload files (POST /api/upload), and pick one. Calls onSelect with the URL
 * (back-compat) and, when provided, onSelectItem with the full media row — needed
 * when the caller must persist the media id (e.g. product media links).
 *
 * Two independent notions of "multiple", easy to confuse:
 *   uploading — always multi-file. The file dialog takes any number and they're
 *               posted one per request, since /api/upload handles a single file.
 *   selecting — controlled by `multi`. When set, the picker stays open after
 *               each pick (onSelect fires per click) so the caller can collect
 *               several; "Done" closes it. Otherwise the first pick closes it.
 */
export function MediaPicker({
  open,
  onClose,
  onSelect,
  onSelectItem,
  accept = "image",
  multi = false,
}: {
  open: boolean;
  onClose: () => void;
  onSelect?: (url: string) => void;
  onSelectItem?: (item: MediaPickerItem) => void;
  accept?: "image" | "video" | "all";
  multi?: boolean;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  /** Drives the "Uploading 2/5" label — null when idle. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** Per-file failures from the last batch; the successful ones still land. */
  const [failed, setFailed] = useState<string[]>([]);
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

  /**
   * Uploads every picked file. POST /api/upload takes one file per request, so
   * this loops rather than sending a batch — sequentially, so a folder of large
   * videos can't fire twenty concurrent multipart requests at the API.
   *
   * One bad file (too large, unsupported type) must not sink the rest: each is
   * caught on its own, the good ones still appear, and the names that failed
   * are listed instead of the old silent swallow.
   */
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploading(true);
    setFailed([]);
    setProgress({ done: 0, total: files.length });

    const problems: string[] = [];
    for (const [i, file] of files.entries()) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        // /api/* is a Next rewrite to the Hono API. With that API down the
        // rewrite returns an HTML error page, so parsing must be guarded —
        // otherwise every file reports a generic failure and the real cause
        // (nothing listening on :4000) never surfaces.
        const isJson = res.headers.get("content-type")?.includes("application/json");
        if (!isJson) {
          problems.push(
            `${file.name} — API unreachable (HTTP ${res.status}). Is the API server running?`
          );
        } else {
          const data = await res.json();
          if (data.success && data.media) {
            // Prepend as each finishes so the grid fills in as it goes.
            setItems((prev) => [data.media, ...prev]);
          } else {
            problems.push(`${file.name}${data.error ? ` — ${data.error}` : " — rejected"}`);
          }
        }
      } catch (err) {
        problems.push(`${file.name} — ${(err as Error).message || "network error"}`);
      }
      setProgress({ done: i + 1, total: files.length });
    }

    setFailed(problems);
    setUploading(false);
    setProgress(null);
    // Allows re-picking the same file after a failure.
    e.target.value = "";
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-3xl max-h-[80vh] flex flex-col bg-white dark:bg-zinc-950 border border-[#432992] rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 p-4 border-b border-[#432992]">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Select media</h2>
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileRef}
              className="hidden"
              accept={uploadAccept}
              multiple
              onChange={upload}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="Select one or more files"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs font-semibold disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {progress ? `Uploading ${progress.done}/${progress.total}` : "Upload"}
            </button>
            {multi ? (
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors"
              >
                Done
              </button>
            ) : null}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {failed.length > 0 && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-semibold">
              {failed.length} file{failed.length > 1 ? "s" : ""} didn&apos;t upload — the rest did.
            </p>
            <ul className="mt-1 list-inside list-disc">
              {failed.map((f) => (
                <li key={f} className="truncate">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400 text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading media…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2 text-zinc-400">
              <ImageIcon className="h-8 w-8 opacity-60" />
              <p className="text-sm">No media yet — click Upload to add some.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {visible.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onSelect?.(m.url);
                    onSelectItem?.(m);
                    if (!multi) onClose();
                  }}
                  className="group relative aspect-video rounded-xl overflow-hidden border border-[#432992] hover:border-zinc-900 dark:hover:border-zinc-300 hover:ring-2 hover:ring-zinc-900/10 transition-all"
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
