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
  Cast,
} from "lucide-react";
import { classifyLink, mediaEmbedUrl } from "@platform/types";
import { useBrowserSession } from "@platform/ui/browser-session";
import { PushPageDialog } from "./push-page-dialog";

const TYPE_LABELS: Record<string, string> = {
  youtube: "YouTube",
  drive: "Google Drive",
  document: "PDF",
  sheet: "Spreadsheet",
  presentation: "Presentation",
  link: "Web page",
};

const SUGGESTIONS = [
  "https://www.google.com",
  "https://www.youtube.com",
  "https://en.wikipedia.org",
];

/** Anything that isn't an address is handed to Google, exactly as an omnibox does. */
function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * Accept what people actually type — "example.com" as readily as a full URL.
 * Returns null for anything that isn't a usable http(s) address, which the
 * caller then treats as a search phrase.
 */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A bare host/path gets the scheme it obviously meant. Anything with a space
  // or no dot is a search phrase, so it fails the parse below on purpose.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : /^[^\s/]+\.[^\s/]/.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * What to actually load in the headless browser for a given address. Real
 * Chromium renders PDFs, plain pages, YouTube and Drive links natively — same as
 * it would for a human — so only spreadsheets/decks (which Chrome has no native
 * viewer for) get redirected to the CMS's own client-side viewer page.
 */
function resolveNavTarget(raw: string): { type: string; navUrl: string } {
  const classified = classifyLink(raw);
  const type = classified?.type ?? "link";
  const navUrl =
    type === "sheet" || type === "presentation" ? mediaEmbedUrl(type, classified?.url ?? raw) : raw;
  return { type, navUrl };
}

export function BrowserView() {
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPushDialog, setShowPushDialog] = useState(false);

  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const session = useBrowserSession(startUrl, { interactive: true });
  const current = session.url ?? startUrl;

  // Keep the address bar in sync with real navigation — including a link the
  // admin clicked *inside* the rendered page, which the old iframe version had
  // no way to observe at all.
  useEffect(() => {
    if (session.url) setInput(session.url);
  }, [session.url]);

  const currentType = useMemo(() => {
    if (!current) return null;
    return classifyLink(current)?.type ?? "link";
  }, [current]);

  /** The address bar is an omnibox: addresses open, anything else searches. */
  const navigate = useCallback(
    (raw: string) => {
      const typed = raw.trim();
      if (!typed) return;

      const entry = normalizeUrl(typed) ?? googleSearchUrl(typed);
      setInput(entry);
      setSaved(false);
      setSaveError(null);

      const { navUrl } = resolveNavTarget(entry);
      if (!startUrl) {
        setStartUrl(navUrl);
      } else {
        session.navigate(navUrl);
      }
    },
    [startUrl, session]
  );

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

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      session.click(e.clientX, e.clientY);
      hiddenInputRef.current?.focus();
    },
    [session]
  );

  const handleCanvasWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      session.scroll(e.deltaY);
    },
    [session]
  );

  const SPECIAL_KEYS = ["Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 border-b border-zinc-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#0a0a0a] sm:flex-row sm:items-center">
        <div className="flex items-center gap-1">
          <ToolbarButton onClick={session.goBack} disabled={!session.canGoBack} label="Back">
            <ArrowLeft className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={session.goForward} disabled={!session.canGoForward} label="Forward">
            <ArrowRight className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={session.reload} disabled={!current} label="Reload">
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
          {currentType && (
            <span className="mr-1 hidden shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-white/5 dark:text-zinc-400 lg:inline">
              {TYPE_LABELS[currentType] ?? currentType}
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

      {saveError && (
        <p className="flex items-center gap-2 bg-red-50 px-4 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {saveError}
        </p>
      )}

      {session.error && (
        <p className="flex items-center gap-2 bg-red-50 px-4 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {session.error}
        </p>
      )}

      {/* Viewport */}
      <div className="relative min-h-0 flex-1 bg-zinc-200 dark:bg-[#050505]">
        {startUrl ? (
          <>
            <canvas
              ref={session.canvasRef}
              onClick={handleCanvasClick}
              onWheel={handleCanvasWheel}
              className="h-full w-full cursor-default bg-white"
            />
            {/* Invisible focus target that turns keystrokes into BROWSER_CONTROL
                messages — the standard remote-canvas-browser input trick. */}
            <input
              ref={hiddenInputRef}
              className="pointer-events-none absolute h-px w-px opacity-0"
              aria-hidden="true"
              onKeyDown={(e) => {
                if (SPECIAL_KEYS.includes(e.key)) {
                  e.preventDefault();
                  session.sendKey(e.key);
                }
              }}
              onInput={(e) => {
                const el = e.target as HTMLInputElement;
                if (el.value) {
                  session.type(el.value);
                  el.value = "";
                }
              }}
            />
            {!session.ready && !session.error && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-black/40">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
              </div>
            )}
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

function EmptyState({ onPick }: { onPick: (url: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <Globe className="h-10 w-10 text-zinc-400 opacity-60" />
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">Browser</p>
        <p className="mt-1 max-w-md text-xs text-zinc-400">
          Search Google or open any link, right here. Pages render on the server via headless
          Chrome, so nothing gets blocked the way an embedded frame would.
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
