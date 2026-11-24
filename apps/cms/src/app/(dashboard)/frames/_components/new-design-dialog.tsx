"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { CANVAS_MAX_SIDE, CANVAS_MIN_SIDE, CANVAS_SIZE_PRESETS, type CanvasContent } from "@platform/ui/templates/canvas";
import { StoryFrame, STORY_APP_DESCRIPTIONS, STORY_APP_ICON, STORY_APP_LABELS, type StoryAppKind } from "@platform/ui/templates/story";
import { createDesign, createStory } from "@/actions/design-actions";
import { toStoryBrand, type BrandKit } from "@/templates/brand";
import { BLANK_TEMPLATE_ID, TemplatePicker, buildTemplate, templateLabel } from "@/templates/canvas/template-picker";
import { STORY_MODULE_KINDS, STORY_THEMES, composeStory, type StoryScreen } from "@/templates/story/presets";
import "@/templates/canvas/fonts";
import { card, thumbStyle } from "./form-fields";

const CUSTOM = "custom";

/** Idle and home screen defaults; changed later in the story editor. */
const SCREEN_DEFAULTS = { backgroundUrl: null, prompt: "Touch to explore", timeoutSeconds: 60 } as const;

function StepLabel({ n, children, hint }: { n: number; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-[9px] tracking-normal text-white">{n}</span>
        {children}
      </span>
      {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
    </div>
  );
}

function Icon({ d, size = 18, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/** Creates a Design or a Story in the brand chosen on the Frames screen (or none). */
export function NewDesignDialog({ onClose, brand }: { onClose: () => void; brand: BrandKit | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // ① What and how big.
  const [kind, setKind] = useState<"canvas" | "story">("canvas");
  const [name, setName] = useState("");
  const [sizeId, setSizeId] = useState(CANVAS_SIZE_PRESETS[0]!.id);
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);

  // ② Design: a template. Story: modules, look and screens.
  const [startId, setStartId] = useState(BLANK_TEMPLATE_ID);
  const [modules, setModules] = useState<StoryAppKind[]>(["timeline", "map", "showcase"]);
  const [themeId, setThemeId] = useState(STORY_THEMES[0]!.id);
  const [examples, setExamples] = useState(true);

  const size =
    sizeId === CUSTOM
      ? {
          width: Math.min(CANVAS_MAX_SIDE, Math.max(CANVAS_MIN_SIDE, Math.round(customW) || 1920)),
          height: Math.min(CANVAS_MAX_SIDE, Math.max(CANVAS_MIN_SIDE, Math.round(customH) || 1080)),
        }
      : CANVAS_SIZE_PRESETS.find((s) => s.id === sizeId)!;

  const screen = useMemo<StoryScreen>(
    () => ({ ...(brand ? { name: brand.name, tagline: brand.tagline } : {}), ...SCREEN_DEFAULTS }),
    [brand]
  );

  /** No brand: one composed story per signature theme, so each thumbnail shows the picked modules. */
  const themed = useMemo(
    () =>
      kind !== "story" || brand
        ? []
        : STORY_THEMES.map((t) => ({
            theme: t,
            ...composeStory({ modules, look: { kind: "theme", themeId: t.id }, screen, examples, width: size.width, height: size.height }),
          })),
    [kind, brand, modules, screen, examples, size.width, size.height]
  );

  const branded = useMemo(
    () =>
      kind !== "story" || !brand
        ? null
        : composeStory({ modules, look: { kind: "brand", brand: toStoryBrand(brand) }, screen, examples, width: size.width, height: size.height }),
    [kind, brand, modules, screen, examples, size.width, size.height]
  );

  const toggleModule = (k: StoryAppKind) => setModules((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]));

  const create = () => {
    setError(null);
    if (kind === "story") {
      const story = branded ?? themed.find((t) => t.theme.id === themeId) ?? themed[0]!;
      const finalName = name.trim() || brand?.name.trim() || story.defaultName;
      startTransition(async () => {
        const res = await createStory(finalName, story.content);
        if (!res.success) return setError(res.error);
        router.push(`/edit/experiences/${res.slug}`);
      });
      return;
    }
    const content: CanvasContent = { version: 1, width: size.width, height: size.height, pages: [buildTemplate(startId, size.width, size.height, brand)] };
    const finalName = name.trim() || templateLabel(startId) || "Untitled design";
    startTransition(async () => {
      const res = await createDesign(finalName, content);
      if (!res.success) return setError(res.error);
      router.push(`/edit/experiences/${res.slug}`);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Create new"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(92vh,880px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl dark:bg-[#0f0f0f]"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-baseline gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">New {kind === "story" ? "story" : "design"}</h2>
            <span className="truncate text-[11px] text-zinc-500">
              {brand ? `In your brand${brand.name.trim() ? ` · ${brand.name.trim()}` : ""}` : "No brand"} — change it on the Frames screen
            </span>
          </div>
          <button type="button" data-plain onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-500 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto p-5 [scrollbar-gutter:stable]">
          {/* ① What to make */}
          <section className="flex flex-col gap-4">
            <StepLabel n={1}>What are you making?</StepLabel>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["canvas", "Design", "A screen layout — text, images, video, shapes. Plays on its own.", "M4 4h16v16H4zM4 9h16M9 9v11"],
                  ["story", "Story", "An interactive touchscreen experience: an idle loop, a menu and the modules you choose.", STORY_APP_ICON.hotspots],
                ] as const
              ).map(([k, label, desc, icon]) => (
                <button key={k} type="button" data-plain onClick={() => setKind(k)} className={`flex items-start gap-3 p-4 ${card(kind === k)}`}>
                  <Icon d={icon} size={20} className="mt-0.5 shrink-0 text-violet-500" />
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
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !isPending && create()}
                placeholder={kind === "story" ? "e.g. Our heritage" : "e.g. Lobby welcome"}
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
                    <button key={s.id} type="button" data-plain onClick={() => setSizeId(s.id)} className={`flex flex-col items-center gap-2 p-3 text-center ${card(active)}`}>
                      <div className="flex h-12 items-center justify-center">
                        <div
                          className={`rounded-[3px] border-2 ${active ? "border-violet-500" : "border-zinc-400"}`}
                          style={portrait ? { height: 44, width: (44 * s.width) / s.height } : { width: 44, height: (44 * s.height) / s.width }}
                        />
                      </div>
                      <div className="w-full min-w-0 text-center">
                        <p className="truncate text-[11px] font-semibold leading-tight text-zinc-800 dark:text-zinc-100">
                          {s.id === CUSTOM ? "Custom" : s.label.split(" · ")[0]}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] leading-tight text-zinc-500">{s.id === CUSTOM ? "Any size" : s.label.split(" · ")[1] ?? "1:1"}</p>
                        <p className="truncate text-[10px] leading-tight text-zinc-500 tabular-nums">
                          {s.id === CUSTOM ? `${Math.round(customW)}×${Math.round(customH)}` : `${s.width}×${s.height}`}
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
          </section>

          {kind === "canvas" ? (
            /* ② Design: a template, in the brand or in its own theme */
            <section className="flex flex-col gap-2">
              <StepLabel n={2} hint={brand ? "Shown in your brand" : "Shown in each template's own theme"}>
                Start from a template
              </StepLabel>
              <TemplatePicker width={size.width} height={size.height} value={startId} onPick={setStartId} includeBlank brand={brand} />
            </section>
          ) : (
            <>
              {/* ② Story modules */}
              <section className="flex flex-col gap-2">
                <StepLabel n={2} hint={`${modules.length} selected · each becomes a tile on the home menu`}>
                  Modules
                </StepLabel>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {STORY_MODULE_KINDS.map((k) => {
                    const on = modules.includes(k);
                    return (
                      <button key={k} type="button" data-plain aria-pressed={on} onClick={() => toggleModule(k)} className={`relative flex flex-col gap-1.5 p-3 ${card(on)}`}>
                        <span
                          className={`absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded border ${
                            on ? "border-violet-500 bg-violet-500 text-white" : "border-zinc-300 dark:border-zinc-600"
                          }`}
                        >
                          {on && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <Icon d={STORY_APP_ICON[k]} className={on ? "text-violet-500" : "text-zinc-400"} />
                        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">{STORY_APP_LABELS[k]}</span>
                        <span className="text-[10.5px] leading-snug text-zinc-500">{STORY_APP_DESCRIPTIONS[k]}</span>
                      </button>
                    );
                  })}
                </div>
                {modules.length === 0 && <p className="text-[11px] text-zinc-500">No modules — the story starts with an empty menu and you add them in the editor.</p>}
                <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                  <input type="checkbox" checked={examples} onChange={(e) => setExamples(e.target.checked)} className="accent-violet-600" />
                  Fill modules with example content to replace
                </label>
              </section>

              {/* ③ No brand: a signature theme */}
              {!brand && (
                <section className="flex flex-col gap-3">
                  <StepLabel n={3}>Theme</StepLabel>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {themed.map(({ theme, content }) => (
                      <button key={theme.id} type="button" data-plain onClick={() => setThemeId(theme.id)} className="flex flex-col gap-1 text-left">
                        <div
                          className={`flex h-32 items-center justify-center rounded-lg border-2 bg-zinc-100 p-1.5 dark:bg-zinc-800 ${
                            themeId === theme.id ? "border-violet-500" : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-600"
                          }`}
                        >
                          <StoryFrame content={content} still className="max-h-full max-w-full rounded-sm" style={thumbStyle(size.width, size.height)} />
                        </div>
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{theme.label}</span>
                        <span className="text-[11px] leading-snug text-zinc-500">{theme.description}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <p className="min-w-0 truncate text-xs text-red-500">{error}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-full btn-surface px-4 text-xs font-normal uppercase tracking-wider">
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
