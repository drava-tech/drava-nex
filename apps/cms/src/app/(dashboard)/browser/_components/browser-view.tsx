"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Globe,
  ExternalLink,
  Search,
  Loader2,
  Check,
  Plus,
  AlertTriangle,
  Puzzle,
  Cast,
} from "lucide-react";
// normalizeUrl is shared with the media Add-link dialog and the API, so the
// omnibox here accepts exactly what the library will accept.
import { classifyLink, mediaEmbedUrl, normalizeUrl } from "@platform/types";
import { PushPageDialog } from "./push-page-dialog";

const TYPE_LABELS: Record<string, string> = {
  youtube: "YouTube",
  drive: "Google Drive",
  document: "PDF",
  sheet: "Spreadsheet",
  presentation: "Presentation",
  image: "Image",
  video: "Video",
  link: "Web page",
};

/** Sites that refuse embedding give no signal, so fall back on time. */
const BLOCKED_HINT_MS = 4000;

/**
 * Set on <html> by the Frame Unlock extension's content script (see
 * tools/frame-unlock-extension). Without it, sites that send X-Frame-Options
 * won't render and there is nothing this page can do about it.
 */
const EXTENSION_MARKER = "data-cms-frame-unlock";

const SUGGESTIONS = [
  "https://www.google.com",
  "https://www.youtube.com",
  "https://en.wikipedia.org",
];

/** Anything that isn't an address is handed to Google, exactly as an omnibox does. */
function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export function BrowserView() {
  // Visited list plus a cursor into it, kept in one piece of state so Back and
  // Forward can't race each other.
  const [nav, setNav] = useState<{ entries: string[]; cursor: number }>({
    entries: [],
    cursor: -1,
  });
  const [input, setInput] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [maybeBlocked, setMaybeBlocked] = useState(false);
  const [hasExtension, setHasExtension] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPushDialog, setShowPushDialog] = useState(false);

  const blockedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = nav.cursor >= 0 ? (nav.entries[nav.cursor] ?? null) : null;

  // Checked after mount so SSR markup and first client render agree.
  useEffect(() => {
    setHasExtension(document.documentElement.hasAttribute(EXTENSION_MARKER));
  }, []);

  /**
   * Resolve through the same embed resolver the media library and screens use,
   * so a PDF, spreadsheet or .pptx opens in the right viewer instead of being
   * downloaded. Ordinary web pages pass through untouched.
   */
  const resolved = useMemo(() => {
    if (!current) return null;
    const classified = classifyLink(current);
    const type = classified?.type ?? "link";
    return { type, src: mediaEmbedUrl(type, classified?.url ?? current) };
  }, [current]);

  /** The address bar is an omnibox: addresses open, anything else searches. */
  const navigate = useCallback(
    (raw: string) => {
      const typed = raw.trim();
      if (!typed) return;

      const entry = normalizeUrl(typed) ?? googleSearchUrl(typed);
      setInput(entry);

      // Re-entering what's already open reads as a reload, not a second entry.
      if (current === entry) {
        setReloadKey((k) => k + 1);
        return;
      }

      setNav((prev) => {
        // Forward entries are discarded on a new navigation, as browsers do.
        const entries = [...prev.entries.slice(0, prev.cursor + 1), entry];
        return { entries, cursor: entries.length - 1 };
      });
    },
    [current]
  );

  const go = useCallback(
    (delta: number) => {
      const next = nav.cursor + delta;
      if (next < 0 || next >= nav.entries.length) return;
      setNav((prev) => ({ ...prev, cursor: next }));
      setInput(nav.entries[next] ?? "");
    },
    [nav]
  );

  // Reset per-page state on every navigation or reload, and start the "did this
  // actually render?" clock.
  useEffect(() => {
    if (!current) return;
    setMaybeBlocked(false);
    setSaved(false);
    setSaveError(null);

    const timer = setTimeout(() => setMaybeBlocked(true), BLOCKED_HINT_MS);
    blockedTimer.current = timer;
    return () => clearTimeout(timer);
  }, [current, reloadKey]);

  const handleFrameLoad = useCallback(() => {
    if (blockedTimer.current) clearTimeout(blockedTimer.current);
    setMaybeBlocked(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!current || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/media/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to save link");
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save link");
    } finally {
      setSaving(false);
    }
  }, [current, saving]);

  const canGoBack = nav.cursor > 0;
  const canGoForward = nav.cursor < nav.entries.length - 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 border-b border-zinc-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#0a0a0a] sm:flex-row sm:items-center">
        <div className="flex items-center gap-1">
          <ToolbarButton onClick={() => go(-1)} disabled={!canGoBack} label="Back">
            <ArrowLeft className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => go(1)} disabled={!canGoForward} label="Forward">
            <ArrowRight className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={!current}
            label="Reload"
          >
            <RotateCw className="h-4 w-4" />
          </ToolbarButton>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate(input);
          }}
          className="relative flex-1"
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search Google, or enter a link"
            spellCheck={false}
            className="h-10 w-full rounded-full border border-transparent bg-zinc-100 pl-9 pr-3 text-sm outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:bg-white/5 dark:text-white dark:focus:bg-[#111]"
          />
        </form>

        <div className="flex items-center gap-1">
          {resolved && (
            <span className="mr-1 hidden shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-white/5 dark:text-zinc-400 lg:inline">
              {TYPE_LABELS[resolved.type] ?? resolved.type}
            </span>
          )}
          <ToolbarButton
            onClick={() => setShowPushDialog(true)}
            disabled={!current}
            label="Push to screen"
          >
            <Cast className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={handleSave}
            disabled={!current || saving}
            label="Save to media library"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </ToolbarButton>
          <ToolbarButton
            onClick={() => current && window.open(current, "_blank", "noopener,noreferrer")}
            disabled={!current}
            label="Open in a new tab"
          >
            <ExternalLink className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </div>

      {!hasExtension && <ExtensionPrompt />}

      {saveError && (
        <p className="flex items-center gap-2 bg-red-50 px-4 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {saveError}
        </p>
      )}

      {/* Viewport */}
      <div className="relative min-h-0 flex-1 bg-zinc-200 dark:bg-[#050505]">
        {resolved ? (
          <>
            <iframe
              key={`${resolved.src}-${reloadKey}`}
              src={resolved.src}
              title={current ?? "Browser"}
              onLoad={handleFrameLoad}
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation"
              allow="autoplay; encrypted-media; fullscreen; clipboard-write"
            />
            {maybeBlocked && <BlockedNotice url={current} hasExtension={hasExtension} />}
          </>
        ) : (
          <EmptyState onPick={navigate} />
        )}
      </div>

      {showPushDialog && current && (
        <PushPageDialog url={current} onClose={() => setShowPushDialog(false)} />
      )}
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
    >
      {children}
    </button>
  );
}

/**
 * Without the extension most large sites won't render, and the page can't
 * detect that per-site — so say it once, up front, rather than after each
 * failure.
 */
function ExtensionPrompt() {
  return (
    <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/10">
      <Puzzle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">
        <span className="font-medium">Frame Unlock isn&apos;t installed on this machine.</span>{" "}
        Google, YouTube and most large sites will stay blank until it is. Load{" "}
        <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-500/20">
          tools/frame-unlock-extension
        </code>{" "}
        via <span className="font-medium">chrome://extensions → Load unpacked</span>, then reload
        this page.
      </p>
    </div>
  );
}

/** Shown when nothing has rendered after a beat. */
function BlockedNotice({ url, hasExtension }: { url: string | null; hasExtension: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
      <div className="pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur dark:border-white/10 dark:bg-[#111]/95">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 text-xs">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">Nothing rendered yet</p>
          <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
            {hasExtension
              ? "A few sites bounce out of frames in JavaScript, which no extension can stop. Opening it in a new tab always works."
              : "Install the Frame Unlock extension, or open it in a new tab."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
          className="ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-700"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (url: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <Globe className="h-10 w-10 text-zinc-400 opacity-60" />
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">Browser</p>
        <p className="mt-1 max-w-md text-xs text-zinc-400">
          Search Google or open any link, right here. PDFs, spreadsheets and decks render with the
          same viewers the screens use.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {SUGGESTIONS.map((url) => (
          <button
            key={url}
            onClick={() => onPick(url)}
            className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-white hover:text-zinc-900 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
          >
            {new URL(url).hostname.replace(/^www\./, "")}
          </button>
        ))}
      </div>
    </div>
  );
}
