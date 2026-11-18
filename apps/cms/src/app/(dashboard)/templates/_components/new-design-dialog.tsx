"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import {
  CANVAS_MAX_SIDE,
  CANVAS_MIN_SIDE,
  CANVAS_SIZE_PRESETS,
  CanvasThumbnail,
  blankPage,
  type CanvasContent,
  type CanvasPage,
} from "@platform/ui/templates/canvas";
import { blankStory, StoryFrame, STORY_APP_ICON, type StoryContent } from "@platform/ui/templates/story";
import { createDesign, createStory } from "@/actions/design-actions";
import { CANVAS_PRESETS } from "@/templates/canvas/presets";
import { sampleStory } from "@/templates/story/sample";

const CUSTOM = "custom";

export function NewDesignDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sizeId, setSizeId] = useState(CANVAS_SIZE_PRESETS[0]!.id);
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);
  const [startId, setStartId] = useState("blank");
  const [kind, setKind] = useState<"canvas" | "story">("canvas");
  const [storyStart, setStoryStart] = useState<"sample" | "blank">("sample");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const size =
    sizeId === CUSTOM
      ? {
          width: Math.min(CANVAS_MAX_SIDE, Math.max(CANVAS_MIN_SIDE, Math.round(customW) || 1920)),
          height: Math.min(CANVAS_MAX_SIDE, Math.max(CANVAS_MIN_SIDE, Math.round(customH) || 1080)),
        }
      : CANVAS_SIZE_PRESETS.find((s) => s.id === sizeId)!;

  const starts = useMemo(() => {
    const list: { id: string; label: string; page: CanvasPage }[] = [
      { id: "blank", label: "Blank", page: blankPage() },
    ];
    for (const p of CANVAS_PRESETS) list.push({ id: p.id, label: p.label, page: p.build(size.width, size.height) });
    return list;
  }, [size.width, size.height]);

  const stories = useMemo(
    () => ({ sample: sampleStory(size.width, size.height), blank: blankStory(size.width, size.height) }) as Record<"sample" | "blank", StoryContent>,
    [size.width, size.height]
  );

  const create = () => {
    setError(null);
    if (kind === "story") {
      const content = stories[storyStart];
      const finalName = name.trim() || (storyStart === "sample" ? "Our story" : "Untitled story");
      startTransition(async () => {
        const res = await createStory(finalName, content);
        if (!res.success) return setError(res.error);
        router.push(`/edit/experiences/${res.slug}`);
      });
      return;
    }
    const start = starts.find((s) => s.id === startId) ?? starts[0]!;
    const content: CanvasContent = { version: 1, width: size.width, height: size.height, pages: [start.page] };
    const finalName = name.trim() || (start.id === "blank" ? "Untitled design" : start.label);
    startTransition(async () => {
      const res = await createDesign(finalName, content);
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.push(`/edit/experiences/${res.slug}`);
    });
  };

  const thumbStyle = (w: number, h: number): React.CSSProperties =>
    w >= h ? { width: "100%", aspectRatio: `${w} / ${h}` } : { height: "100%", aspectRatio: `${w} / ${h}` };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="New design"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl dark:bg-[#0f0f0f]"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">New {kind === "story" ? "story" : "design"}</h2>
          <button type="button" data-plain onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-500 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["canvas", "Design", "A screen layout — text, images, video, shapes. Plays on its own.", "M4 4h16v16H4zM4 9h16M9 9v11"],
                ["story", "Story", "An interactive touchscreen experience: idle loop, menu, timeline, map, showcase, hotspots.", STORY_APP_ICON.hotspots],
              ] as const
            ).map(([k, label, desc, icon]) => (
              <button
                key={k}
                type="button"
                data-plain
                onClick={() => setKind(k)}
                className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                  kind === k ? "border-violet-500 bg-violet-500/5" : "border-border hover:border-zinc-400"
                }`}
              >
                <svg className="mt-0.5 shrink-0 text-violet-500" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d={icon} />
                </svg>
                <span>
                  <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50">{label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{desc}</span>
                </span>
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isPending && create()}
              placeholder="e.g. Lobby welcome"
              className="h-10 rounded-lg border border-border bg-zinc-50 px-3 text-sm outline-none focus:border-violet-500 dark:bg-zinc-900"
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Size</span>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[...CANVAS_SIZE_PRESETS, { id: CUSTOM, label: "Custom", width: customW, height: customH }].map((s) => {
                const active = sizeId === s.id;
                const portrait = s.height > s.width;
                return (
                  <button
                    key={s.id}
                    type="button"
                    data-plain
                    onClick={() => setSizeId(s.id)}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-colors ${
                      active ? "border-violet-500 bg-violet-500/5" : "border-border hover:border-zinc-400"
                    }`}
                  >
                    <div className="flex h-12 items-center justify-center">
                      <div
                        className={`rounded-[3px] border-2 ${active ? "border-violet-500" : "border-zinc-400"}`}
                        style={portrait ? { height: 44, width: (44 * s.width) / s.height } : { width: 44, height: (44 * s.height) / s.width }}
                      />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold leading-tight text-zinc-800 dark:text-zinc-100">
                        {s.id === CUSTOM ? "Custom" : s.label.split(" · ")[0]}
                      </p>
                      <p className="text-[10px] leading-tight text-zinc-500">
                        {s.id === CUSTOM ? "Any size" : `${s.label.split(" · ")[1]} · ${s.width}×${s.height}`}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
            {sizeId === CUSTOM && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <input
                  type="number"
                  min={CANVAS_MIN_SIDE}
                  max={CANVAS_MAX_SIDE}
                  value={customW}
                  onChange={(e) => setCustomW(Number(e.target.value))}
                  className="h-8 w-24 rounded-md border border-border bg-zinc-50 px-2 text-xs dark:bg-zinc-900"
                  aria-label="Width"
                />
                ×
                <input
                  type="number"
                  min={CANVAS_MIN_SIDE}
                  max={CANVAS_MAX_SIDE}
                  value={customH}
                  onChange={(e) => setCustomH(Number(e.target.value))}
                  className="h-8 w-24 rounded-md border border-border bg-zinc-50 px-2 text-xs dark:bg-zinc-900"
                  aria-label="Height"
                />
                px
              </div>
            )}
          </div>

          {kind === "story" ? (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Start from</span>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ["sample", "Sample story", "Every app type, filled with placeholder content to replace"],
                    ["blank", "Blank story", "An empty menu — add apps yourself"],
                  ] as const
                ).map(([k, label, desc]) => (
                  <button key={k} type="button" data-plain onClick={() => setStoryStart(k)} className="flex flex-col gap-1.5 text-left">
                    <div
                      className={`flex h-40 items-center justify-center rounded-lg border-2 bg-zinc-100 p-1.5 dark:bg-zinc-800 ${
                        storyStart === k ? "border-violet-500" : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-600"
                      }`}
                    >
                      <StoryFrame content={stories[k]} still className="max-h-full max-w-full rounded-sm" style={thumbStyle(size.width, size.height)} />
                    </div>
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
                    <span className="text-[11px] text-zinc-500">{desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Start from</span>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {starts.map((s) => {
                const active = startId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    data-plain
                    onClick={() => setStartId(s.id)}
                    className="flex flex-col gap-1.5 text-left"
                  >
                    <div
                      className={`flex h-24 items-center justify-center rounded-lg border-2 bg-zinc-100 p-1.5 dark:bg-zinc-800 ${
                        active ? "border-violet-500" : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-600"
                      }`}
                    >
                      <CanvasThumbnail
                        content={{ version: 1, width: size.width, height: size.height, pages: [s.page] }}
                        className="max-h-full max-w-full rounded-sm border border-border"
                        style={thumbStyle(size.width, size.height)}
                      />
                    </div>
                    <span className="text-[11px] text-zinc-600 dark:text-zinc-300">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <p className="min-w-0 truncate text-xs text-red-500">{error}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-full btn-surface px-4 text-xs font-normal uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={create}
              disabled={isPending}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-primary px-5 text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create {kind === "story" ? "story" : "design"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
