"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Check } from "lucide-react";
import type { Experience } from "@platform/db";
import { updateExperienceTemplateContent } from "@/actions/experience-actions";
import {
  DATA_ART_STUDIO_ENTRIES,
  DATA_ART_STUDIO_ENTRY_LABELS,
  DEFAULT_DATA_ART_STUDIO_CONTENT,
  DataArtStudioRenderer,
  WORLD_CLOCK_MAX_PLACES,
  dataArtStudioUrl,
  type DataArtStudioContent,
  type DataArtStudioEntry,
  type WorldClockArt,
  type WorldClockStyle,
} from "@platform/ui/templates/data-art-studio";

const FIELD_CLASS =
  "w-full rounded-md border border-[#432992] bg-zinc-100 px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-violet-500 dark:bg-zinc-800 dark:text-zinc-100";

const SECTION_CLASS =
  "text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400";

/** Comma/space separated ids → the stored list (validated again by the reader). */
function parsePlaces(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Full-tab editor for the Data Art Studio template. Everything the studio
 * shows is chosen inside the studio itself (and relayed live by its data
 * feeds), so the only things authored here are which page a screen opens on
 * and, for the World Clock, which clock it runs.
 */
export function DataArtStudioEditorWorkspace({
  experience,
  initialContent,
}: {
  experience: Experience;
  initialContent: DataArtStudioContent;
}) {
  const router = useRouter();
  const [content, setContent] = useState<DataArtStudioContent>({
    ...DEFAULT_DATA_ART_STUDIO_CONTENT,
    ...initialContent,
  });
  // Kept as typed so "london, " doesn't lose its trailing separator mid-edit.
  const [placesText, setPlacesText] = useState(content.clockPlaces.join(", "));
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<DataArtStudioContent>) => {
    setSaved(false);
    setContent((c) => ({ ...c, ...patch }));
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateExperienceTemplateContent(
        experience.id,
        "data-art-studio",
        content
      );
      if (res.success) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? "Failed to save.");
      }
    });
  };

  const isClock = content.entry === "world-clock";

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-100 dark:bg-zinc-950">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[#432992] bg-white px-4 dark:bg-zinc-900">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/experiences"
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Back to experiences"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {experience.name}
            </p>
            <p className="text-[11px] text-zinc-400">Data Art Studio</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/preview/experiences/${experience.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View
          </a>
          <button
            onClick={save}
            disabled={isPending}
            className="flex min-w-[84px] items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : saved ? (
              <Check className="h-3.5 w-3.5" />
            ) : null}
            {isPending ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[400px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-[#432992] bg-white p-4 dark:bg-zinc-900">
          <div className="flex flex-col gap-3">
            <h2 className={SECTION_CLASS}>Opens on</h2>
            <select
              value={content.entry}
              onChange={(e) => update({ entry: e.target.value as DataArtStudioEntry })}
              className={FIELD_CLASS}
            >
              {DATA_ART_STUDIO_ENTRIES.map((entry) => (
                <option key={entry} value={entry}>
                  {DATA_ART_STUDIO_ENTRY_LABELS[entry]}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-zinc-400">
              The Studio is the full app: pick an art, then Weather or Attendance, and
              Generate. Flight Garden and World Clock open those pages directly.
            </p>
          </div>

          {isClock && (
            <>
              <div className="flex flex-col gap-3">
                <h2 className={SECTION_CLASS}>Cities (up to {WORLD_CLOCK_MAX_PLACES})</h2>
                <input
                  type="text"
                  value={placesText}
                  onChange={(e) => {
                    setPlacesText(e.target.value);
                    update({ clockPlaces: parsePlaces(e.target.value).slice(0, WORLD_CLOCK_MAX_PLACES) });
                  }}
                  placeholder="newyork, london, bengaluru, tokyo, sydney"
                  className={FIELD_CLASS}
                />
                <p className="text-[11px] text-zinc-400">
                  City ids, comma separated (e.g. <code>newyork</code>, <code>losangeles</code>).
                  Leave blank to open on the clock&apos;s city picker. Unknown ids are skipped.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <h2 className={SECTION_CLASS}>Artwork</h2>
                <select
                  value={content.clockArt}
                  onChange={(e) => update({ clockArt: e.target.value as WorldClockArt })}
                  className={FIELD_CLASS}
                >
                  <option value="map">World Map</option>
                  <option value="fabric">Fabric</option>
                </select>
              </div>

              <div className="flex flex-col gap-3">
                <h2 className={SECTION_CLASS}>Clock face</h2>
                <select
                  value={content.clockStyle}
                  onChange={(e) => update({ clockStyle: e.target.value as WorldClockStyle })}
                  className={FIELD_CLASS}
                >
                  <option value="analog">Analog</option>
                  <option value="digital">Digital</option>
                </select>
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <h2 className={SECTION_CLASS}>Page</h2>
            <a
              href={dataArtStudioUrl(content)}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-[11px] text-violet-500 hover:underline"
            >
              {dataArtStudioUrl(content)}
            </a>
          </div>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </aside>

        <main className="min-w-0 flex-1 bg-zinc-200 p-6 dark:bg-zinc-900/40">
          {/* A live 16:9 instance of the real page; the renderer reloads it only when its URL changes. */}
          <div className="aspect-video w-full overflow-hidden rounded-xl border border-[#432992] bg-[#05070a]">
            <DataArtStudioRenderer content={content} />
          </div>
        </main>
      </div>
    </div>
  );
}
