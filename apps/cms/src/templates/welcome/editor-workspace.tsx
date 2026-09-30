"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Check, Film, X } from "lucide-react";
import type { Experience } from "@platform/db";
import { updateExperienceTemplateContent } from "@/actions/experience-actions";
import { MediaPicker } from "@/components/media-picker";
import { ScreenStage } from "@platform/ui/templates/portfolio";
import { DEFAULT_WELCOME_CONTENT, WelcomeRenderer, type WelcomeContent } from "@platform/ui/templates/welcome";

/**
 * Full-tab editor for the Welcome template: headline/subtitle text fields plus
 * a video picker (reuses the shared MediaPicker), with a live preview that
 * renders exactly what the screen shows.
 */
export function WelcomeEditorWorkspace({
  experience,
  initialContent,
}: {
  experience: Experience;
  initialContent: WelcomeContent;
}) {
  const router = useRouter();
  const [content, setContent] = useState<WelcomeContent>({
    ...DEFAULT_WELCOME_CONTENT,
    ...initialContent,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<WelcomeContent>) => {
    setSaved(false);
    setContent((c) => ({ ...c, ...patch }));
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateExperienceTemplateContent(experience.id, "welcome", content);
      if (res.success) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? "Failed to save.");
      }
    });
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-100 dark:bg-zinc-950">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-white px-4 dark:bg-zinc-900">
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
            <p className="text-[11px] text-zinc-400">Welcome</p>
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
        <aside className="flex w-[400px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-white p-4 dark:bg-zinc-900">
          <div className="flex flex-col gap-3">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              Headline
            </h2>
            <input
              type="text"
              value={content.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="Welcome to Tusker Digital Experience Center"
              className="w-full rounded-md border border-border bg-zinc-100 px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-violet-500 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              Subtitle (optional)
            </h2>
            <input
              type="text"
              value={content.subtitle ?? ""}
              onChange={(e) => update({ subtitle: e.target.value })}
              placeholder="A short tagline"
              className="w-full rounded-md border border-border bg-zinc-100 px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-violet-500 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              Video
            </h2>
            {content.videoUrl ? (
              <div className="group relative aspect-video overflow-hidden rounded-xl border border-border">
                <video src={content.videoUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                <button
                  onClick={() => update({ videoAssetId: undefined, videoUrl: undefined })}
                  className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  title="Remove video"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setPickerOpen(true)}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
              >
                <Film className="h-6 w-6" />
                <span className="text-xs font-medium">Choose a video</span>
              </button>
            )}
            {content.videoUrl && (
              <button
                onClick={() => setPickerOpen(true)}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Change video
              </button>
            )}
          </div>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </aside>

        <main className="min-w-0 flex-1 bg-zinc-200 p-6 dark:bg-zinc-900/40">
          <ScreenStage variant="fit-width">
            <WelcomeRenderer content={content} preview />
          </ScreenStage>
        </main>
      </div>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        accept="video"
        onSelectItem={(item) => update({ videoAssetId: item.id, videoUrl: item.url })}
      />
    </div>
  );
}
