"use client";

import React, { useEffect, useMemo } from "react";
import { Link2 } from "lucide-react";
import { classifyLink } from "@platform/types";

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
 * The URL + Display name fields used by the routed /browser page (see
 * browser-view.tsx) — classification (and thus what will actually be
 * stored) lives here once, so every caller shows the same "Detected: …" hint.
 * The old popup version of this (AddLinkDialog) was removed once every
 * caller was routed to /browser instead.
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
            className="h-11 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-white/5 dark:text-white"
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
          className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-white/5 dark:text-white"
        />
      </div>
    </>
  );
}

