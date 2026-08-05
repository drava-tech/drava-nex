"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Link2, Loader2, AlertCircle, Check, MonitorPlay } from "lucide-react";
import { classifyLink } from "@platform/types";
import { getScreens, getActiveScreens, assignMedia } from "@/actions/screen-actions";
import { currentLabel, type ScreenRow } from "@/components/push-to-screen-modal";
import { OverwriteConfirmDialog } from "@/components/overwrite-confirm-dialog";

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

export type DetectedLink = ReturnType<typeof classifyLink>;

/**
 * The URL + Display name fields shared by AddLinkDialog (popup) and the
 * routed /browser page — classification (and thus what will actually be
 * stored) lives here once, so every caller shows the same "Detected: …" hint.
 */
export function AddLinkFields({
  url,
  name,
  onUrlChange,
  onNameChange,
  onDetectedChange,
  autoFocus = true,
}: {
  url: string;
  name: string;
  onUrlChange: (url: string) => void;
  onNameChange: (name: string) => void;
  onDetectedChange?: (detected: DetectedLink) => void;
  autoFocus?: boolean;
}) {
  // Classify as they type, using the same resolver the server will use — so the
  // hint here can't disagree with what actually gets stored.
  const detected = useMemo(() => (url.trim() ? classifyLink(url) : null), [url]);

  useEffect(() => {
    onDetectedChange?.(detected);
  }, [detected, onDetectedChange]);

  return (
    <>
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
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="example.com, or paste any link"
            autoFocus={autoFocus}
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
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={detected?.name ?? "Auto-detected"}
          className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
        />
      </div>
    </>
  );
}

/**
 * Add any link — a YouTube or Vimeo video, a Drive doc, a direct image/video/PDF
 * URL, or a plain web page. Nothing is turned away: whatever isn't a recognised
 * kind is stored as a web page and framed. Link assets are ordinary media rows
 * with an absolute url and no file on disk, so preview, push and screen
 * playback all work exactly as they do for uploads.
 *
 * Registered pending-save (same as the /browser tool's ad-hoc push) and owns
 * the whole "pick screens, push, go live" sequence itself — on success it
 * closes and navigates straight to /browser/live/[deviceId], same as /browser
 * and MediaPreviewModal's page-type push. Callers only need to know when to
 * hide it (onClose); there's nothing left to hand back.
 */
export function AddLinkDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  // On a tablet, the first tap outside the dialog while a field is focused
  // should just dismiss the on-screen keyboard — not close the whole dialog.
  // Set in the backdrop's pointerdown (before the browser's own blur fires)
  // and consumed by the click right after, so only a second, "clean" tap
  // outside actually closes it.
  const suppressBackdropCloseRef = useRef(false);

  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [detected, setDetected] = useState<DetectedLink>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [screens, setScreens] = useState<ScreenRow[]>([]);
  const [activeScreenIds, setActiveScreenIds] = useState<Set<string>>(new Set());
  const [loadingScreens, setLoadingScreens] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingOverwrite, setPendingOverwrite] = useState<ScreenRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [screenRows, activeIds] = await Promise.all([getScreens(), getActiveScreens()]);
        if (cancelled) return;
        setScreens(screenRows);
        setActiveScreenIds(new Set(activeIds));
      } finally {
        if (!cancelled) setLoadingScreens(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A pending overwrite confirm handles its own dismissal — Escape here
      // shouldn't blow away the whole dialog (and the typed URL/name) under it.
      if (e.key === "Escape" && !pendingOverwrite) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pendingOverwrite]);

  const toggleScreen = (screenId: string) => {
    setSelectedIds((prev) => (prev.includes(screenId) ? prev.filter((id) => id !== screenId) : [...prev, screenId]));
  };

  const doSend = async () => {
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
      const mediaId = data.media.id as string;

      const targets = screens.filter((s) => selectedIds.includes(s.screenId));
      await Promise.all(targets.map((s) => assignMedia(s.screenId, mediaId)));

      // targets is non-empty here: handleSubmit only calls doSend with selectedIds.length > 0.
      const target = targets.find((s) => activeScreenIds.has(s.screenId)) ?? targets[0]!;
      onClose();
      router.push(`/browser/live/${target.screenId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add link");
    } finally {
      setSubmitting(false);
      setPendingOverwrite(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!detected || selectedIds.length === 0 || submitting) return;
    const targets = screens.filter((s) => selectedIds.includes(s.screenId));
    const overwriting = targets.filter((s) => currentLabel(s) !== "Nothing assigned");
    if (overwriting.length > 0) {
      setPendingOverwrite(overwriting);
      return;
    }
    void doSend();
  };

  // Fires before the tap's own focus/blur handling, so document.activeElement
  // here still reflects whatever was focused when the tap landed.
  const handleBackdropPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA") &&
      formRef.current?.contains(active)
    ) {
      e.preventDefault();
      active.blur();
      suppressBackdropCloseRef.current = true;
    }
  };

  const handleBackdropClick = () => {
    if (suppressBackdropCloseRef.current) {
      suppressBackdropCloseRef.current = false;
      return;
    }
    onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        onPointerDown={handleBackdropPointerDown}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-label="Add a link"
      >
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          onClick={(e) => e.stopPropagation()}
          className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0f0f0f]"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 p-5 dark:border-white/10">
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

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
            <AddLinkFields
              url={url}
              name={name}
              onUrlChange={setUrl}
              onNameChange={setName}
              onDetectedChange={setDetected}
            />

            <div className="flex flex-col">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                <MonitorPlay className="h-3.5 w-3.5" /> Send to screen
              </h3>
              {loadingScreens ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading screens…
                </div>
              ) : screens.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-zinc-400">No screens registered yet</p>
              ) : (
                <div className="space-y-1">
                  {screens.map((screen) => {
                    const isSelected = selectedIds.includes(screen.screenId);
                    const isOnline = activeScreenIds.has(screen.screenId);
                    return (
                      <button
                        key={screen.screenId}
                        type="button"
                        onClick={() => toggleScreen(screen.screenId)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                          isSelected
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/5"
                        }`}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              isOnline ? "bg-green-500 shadow-[0_0_6px_#22c55e]" : "bg-zinc-400"
                            }`}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            <span className="block truncate font-medium">{screen.screenName}</span>
                            <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">
                              {currentLabel(screen)}
                            </span>
                          </span>
                        </span>
                        {isSelected && <Check className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {error && (
              <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-200 p-4 dark:border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-full px-5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!detected || selectedIds.length === 0 || submitting}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-blue-600 px-5 text-sm font-medium text-white transition-all hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Add link
            </button>
          </div>
        </form>
      </div>

      {pendingOverwrite && (
        <OverwriteConfirmDialog
          screens={pendingOverwrite}
          pending={submitting}
          onCancel={() => setPendingOverwrite(null)}
          onConfirm={() => void doSend()}
        />
      )}
    </>
  );
}
