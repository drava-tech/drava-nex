"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { X, Upload, Loader2, ImageIcon, Check } from "lucide-react";
import { MediaThumb } from "@/components/media-thumb";

interface MediaItem {
  id: string;
  name: string;
  type: string;
  url: string;
  /** Small derived tile; null for videos/links and pre-backfill images. */
  thumbnailUrl?: string | null;
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
 *               With onUnselectItem, a click on a picked tile takes it back
 *               off instead of adding it again, and `pickedIds` opens the
 *               picker with what the caller already has marked as picked.
 */
export function MediaPicker({
  open,
  onClose,
  onSelect,
  onSelectItem,
  accept = "image",
  multi = false,
  pickedIds,
  onUnselectItem,
}: {
  open: boolean;
  onClose: () => void;
  onSelect?: (url: string) => void;
  onSelectItem?: (item: MediaPickerItem) => void;
  /** "visual" = images and videos only (e.g. a screen schedule's queue). */
  accept?: "image" | "video" | "visual" | "all";
  multi?: boolean;
  /** Multi only: ids already chosen (repeats count), shown as picked on open. */
  pickedIds?: string[];
  /** Multi only: clicking a picked tile unpicks it, and this is called. */
  onUnselectItem?: (item: MediaPickerItem) => void;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  /** For accept="visual": show both, or just images, or just videos. */
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  /** Drives the "Uploading 2/5" label — null when idle. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** Per-file failures from the last batch; the successful ones still land. */
  const [failed, setFailed] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  /** In multi mode: how many times each item was picked since the picker opened. */
  const [picked, setPicked] = useState<Map<string, number>>(new Map());
  // Seeded on open only; while open, the picker keeps its own count.
  const pickedIdsRef = useRef(pickedIds);
  pickedIdsRef.current = pickedIds;
  useEffect(() => {
    if (open) {
      const seed = new Map<string, number>();
      for (const id of pickedIdsRef.current ?? []) seed.set(id, (seed.get(id) ?? 0) + 1);
      setPicked(seed);
      setKind("all");
    }
  }, [open]);
  const pickedTotal = [...picked.values()].reduce((a, b) => a + b, 0);
  const toggles = multi && !!onUnselectItem;

  /** Keyset cursor for the next page, or null once the list is exhausted. */
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  /**
   * One page of media, filtered to the accepted kinds by the API rather than
   * after the fetch — this picker used to download the entire library every
   * time it opened and then throw most of it away.
   */
  const load = useCallback(
    async (cursor: string | null) => {
      if (cursor === null) setLoading(true);
      else setLoadingMore(true);
      try {
        const params = new URLSearchParams({ mode: "cursor", limit: "48" });
        // accept="all" means NO type restriction, not "image and video" —
        // product-media-editor.tsx opens this picker with accept="all"
        // specifically to attach a brochure (PDF/docx/xlsx/pptx), so narrowing
        // it here made every document in the library unselectable.
        if (accept === "visual") params.set("types", kind === "all" ? "image,video" : kind);
        else if (accept !== "all") params.set("types", accept);
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(`/api/media?${params.toString()}`);
        const data = res.ok ? await res.json() : null;
        const page: MediaItem[] = data?.media ?? [];
        setItems((prev) => (cursor === null ? page : [...prev, ...page]));
        setNextCursor(data?.nextCursor ?? null);
      } catch {
        if (cursor === null) setItems([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [accept, kind],
  );

  useEffect(() => {
    if (!open) return;
    void load(null);
  }, [open, load]);

  const sentinelRef = useInfiniteScroll({
    hasMore: nextCursor !== null,
    loading: loading || loadingMore,
    onLoadMore: () => void load(nextCursor),
  });

  if (!open) return null;

  // The API already restricted this to the accepted kinds.
  const visible = items;
  // Mirrors the ALLOWED map in apps/api/src/routes/media.ts. For accept="all"
  // this must offer the document kinds too, or the brochure picker would list
  // PDFs it refuses to let you upload.
  const uploadAccept =
    accept === "video"
      ? "video/*"
      : accept === "visual"
        ? "image/*,video/*"
      : accept === "all"
        ? "image/*,video/*,application/pdf,.xlsx,.csv,.pptx,.docx"
        : "image/*";

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
        className="relative w-full max-w-3xl max-h-[80vh] flex flex-col bg-card text-card-foreground border border-border rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 p-4 border-b border-border">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">Select media</h2>
            {accept === "visual" && (
              <div role="tablist" aria-label="Show" className="flex items-center gap-1 rounded-full bg-muted p-0.5">
                {(
                  [
                    ["all", "All"],
                    ["image", "Images"],
                    ["video", "Videos"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={kind === value}
                    onClick={() => setKind(value)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      kind === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full btn-primary text-xs font-normal disabled:opacity-50 transition-colors"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {progress ? `Uploading ${progress.done}/${progress.total}` : "Upload"}
            </button>
            {multi ? (
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-full btn-surface text-xs font-normal transition-colors"
              >
                {pickedTotal > 0 ? `Done · ${pickedTotal} ${toggles ? "selected" : "added"}` : "Done"}
              </button>
            ) : null}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-accent-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {failed.length > 0 && (
          <div className="mx-4 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading media…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2 text-muted-foreground">
              <ImageIcon className="h-8 w-8 opacity-60" />
              <p className="text-sm">No media yet — click Upload to add some.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {visible.map((m) => {
                const count = picked.get(m.id) ?? 0;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      if (toggles && count > 0) {
                        onUnselectItem?.(m);
                        setPicked((prev) => {
                          const next = new Map(prev);
                          next.delete(m.id);
                          return next;
                        });
                        return;
                      }
                      onSelect?.(m.url);
                      onSelectItem?.(m);
                      if (!multi) onClose();
                      else setPicked((prev) => new Map(prev).set(m.id, (prev.get(m.id) ?? 0) + 1));
                    }}
                    aria-pressed={multi ? count > 0 : undefined}
                    aria-label={count > 0 ? `${m.name}, added${count > 1 ? ` ${count} times` : ""}` : m.name}
                    title={toggles && count > 0 ? `${m.name} · click to remove` : m.name}
                    className={`group relative aspect-video overflow-hidden rounded-xl border transition-all ${
                      count > 0
                        ? "border-primary ring-2 ring-primary/50"
                        : "border-border hover:border-primary/60 hover:ring-2 hover:ring-primary/20"
                    }`}
                  >
                    {/* The thumbnail; for a video without one, its first frame; an icon otherwise. */}
                    <MediaThumb
                      type={m.type}
                      src={m.type === "image" ? (m.thumbnailUrl || m.url) : (m.thumbnailUrl ?? null)}
                      videoSrc={m.type === "video" ? m.url : null}
                      name={m.name}
                    />
                    {count > 0 && (
                      <span className="absolute right-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground shadow">
                        {/* The tick turns into a cross on hover where a click removes it. */}
                        <Check className={`h-3.5 w-3.5 ${toggles ? "group-hover:hidden" : ""}`} strokeWidth={3} />
                        {toggles && <X className="hidden h-3.5 w-3.5 group-hover:block" strokeWidth={3} />}
                        {count > 1 && <span className="tabular-nums">×{count}</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {/* Sentinel: the next page loads when this scrolls into view. */}
          {!loading && nextCursor && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
