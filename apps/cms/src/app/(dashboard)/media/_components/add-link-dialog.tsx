"use client";

import React, { useEffect, useMemo, useState } from "react";
import { X, Link2, Loader2, AlertCircle } from "lucide-react";
import { classifyLink } from "@platform/types";
import type { MediaItem } from "./media-preview-modal";

const TYPE_LABELS: Record<string, string> = {
  youtube: "YouTube video",
  drive: "Google Drive",
  document: "PDF document",
  sheet: "Spreadsheet",
  presentation: "Presentation",
  image: "Image",
  video: "Video",
  link: "Web page",
};

/**
 * Add any link — a YouTube or Vimeo video, a Drive doc, a direct image/video/PDF
 * URL, or a plain web page. Nothing is turned away: whatever isn't a recognised
 * kind is stored as a web page and framed. Link assets are ordinary media rows
 * with an absolute url and no file on disk, so preview, push and screen
 * playback all work exactly as they do for uploads.
 *
 * Registered pending-save (same as the Browser tool's ad-hoc push): the caller
 * opens the resulting item's preview/push popup immediately rather than adding
 * a tile to the grid, and it stays out of the Media Library listing unless
 * explicitly kept via "Save link" in that popup.
 */
export function AddLinkDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (media: MediaItem) => void;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Classify as they type, using the same resolver the server will use — so the
  // hint here can't disagree with what actually gets stored.
  const detected = useMemo(() => (url.trim() ? classifyLink(url) : null), [url]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detected || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/media/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), name: name.trim() || undefined, pendingSave: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to add link");
      onAdded(data.media);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add link");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Add a link"
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0f0f0f]"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 p-5 dark:border-white/10">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Add a link</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div>
            <label
              htmlFor="media-link-url"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              URL
            </label>
            <div className="relative">
              <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                id="media-link-url"
                // Deliberately not type="url": the browser's own validation
                // rejects "example.com", which classifyLink accepts and the
                // server stores happily. One rule for what's valid, and it
                // lives in classifyLink.
                type="text"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="example.com, or paste any link"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                className="h-11 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>
            <p className="mt-2 min-h-[1rem] text-xs">
              {url.trim() && !detected ? (
                <span className="text-amber-600 dark:text-amber-400">
                  That isn&apos;t an address — enter a domain or a full http(s) link
                </span>
              ) : detected ? (
                <span className="text-green-600 dark:text-green-400">
                  Detected: {TYPE_LABELS[detected.type] ?? detected.type}
                  {/* Show what will actually be stored when it isn't what was
                      typed — e.g. a bare host that just gained https://. */}
                  {detected.url !== url.trim() && (
                    <span className="text-zinc-400"> · saves as {detected.url}</span>
                  )}
                </span>
              ) : (
                <span className="text-zinc-400">
                  Any link — video, Drive, PDF, image or a whole web page
                </span>
              )}
            </p>
          </div>

          <div>
            <label
              htmlFor="media-link-name"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Display name <span className="text-zinc-400">(optional)</span>
            </label>
            <input
              id="media-link-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={detected?.name ?? "Auto-detected"}
              className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>

          {error && (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
              <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 p-4 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-full px-5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!detected || submitting}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-blue-600 px-5 text-sm font-medium text-white transition-all hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Add link
          </button>
        </div>
      </form>
    </div>
  );
}
