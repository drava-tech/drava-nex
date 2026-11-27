"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import { CANVAS_MAX_SIDE, CANVAS_MIN_SIDE, CANVAS_SIZE_PRESETS, type CanvasContent } from "@platform/ui/templates/canvas";
import { StoryFrame, STORY_APP_DESCRIPTIONS, STORY_APP_ICON, STORY_APP_LABELS, type StoryAppKind } from "@platform/ui/templates/story";
import { createDesign, createStory } from "@/actions/design-actions";
import { toStoryBrand, type BrandKit } from "@/templates/brand";
import { BLANK_TEMPLATE_ID, TemplatePicker, buildTemplate, templateLabel } from "@/templates/canvas/template-picker";
import { STORY_MODULE_KINDS, STORY_THEMES, composeStory, type StoryScreen } from "@/templates/story/presets";
import "@/templates/canvas/fonts";
import { card, thumbStyle } from "./form-fields";

export type NewKind = "canvas" | "story";

const CUSTOM = "custom";

/** Idle and home screen defaults; changed later in the story editor. */
const SCREEN_DEFAULTS = { backgroundUrl: null, prompt: "Touch to explore", timeoutSeconds: 60 } as const;

const KINDS = [
  {
    kind: "canvas",
    label: "Design",
    desc: "A screen that plays on its own: text, images, video.",
    eg: "Welcome screens, menus, announcements",
    icon: "M4 4h16v16H4zM4 9h16M9 9v11",
  },
  {
    kind: "story",
    label: "Story",
    desc: "An interactive touchscreen people tap through.",
    eg: "Heritage walls, maps, product showcases",
    icon: STORY_APP_ICON.hotspots,
  },
] as const;

function Icon({ d, size = 18, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{children}</h3>
      {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
    </div>
  );
}

/** The two big "what are you making" cards: on the empty Frames screen and as the dialog's first step. */
export function KindChoice({ onPick }: { onPick: (k: NewKind) => void }) {
  return (
    <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
      {KINDS.map((k) => (
        <button
          key={k.kind}
          type="button"
          data-plain
          onClick={() => onPick(k.kind)}
          className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-violet-500 hover:shadow-lg dark:bg-zinc-900"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500">
            <Icon d={k.icon} size={20} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50">{k.label}</span>
            <span className="mt-1 block text-xs leading-snug text-zinc-500">{k.desc}</span>
            <span className="mt-2 block text-[11px] text-zinc-400">{k.eg}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Creates a Design or a Story in the brand chosen on the Frames screen (or none).
 * Step 1 asks which (skipped when `initialKind` is given); step 2 shows only
 * what that kind needs, with size and name tucked into the footer.
 */
export function NewDesignDialog({ onClose, brand, initialKind = null }: { onClose: () => void; brand: BrandKit | null; initialKind?: NewKind | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [kind, setKind] = useState<NewKind | null>(initialKind);
  const [name, setName] = useState("");
  const [sizeId, setSizeId] = useState(CANVAS_SIZE_PRESETS[0]!.id);
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);

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
    if (!kind) return;
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

  const brandNote = brand ? `In ${brand.name.trim() || "your brand"}` : null;

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
        className={`flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl dark:bg-[#0f0f0f] ${
          kind ? "h-[min(92vh,860px)] max-w-4xl" : "max-w-2xl"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            {kind && !initialKind && (
              <button type="button" data-plain onClick={() => setKind(null)} aria-label="Back" className="-ml-1 rounded-md p-1 text-zinc-500 hover:bg-accent">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {kind === "story" ? "New story" : kind === "canvas" ? "New design" : "What do you want to make?"}
            </h2>
            {kind && brandNote && <span className="truncate rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-600 dark:text-violet-300">{brandNote}</span>}
          </div>
          <button type="button" data-plain onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-500 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!kind ? (
          <div className="flex justify-center p-6">
            <KindChoice onPick={setKind} />
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5 [scrollbar-gutter:stable]">
              {kind === "canvas" ? (
                <section className="flex flex-col gap-3">
                  <SectionTitle hint="Start blank or from a ready-made layout">Pick a starting point</SectionTitle>
                  <TemplatePicker width={size.width} height={size.height} value={startId} onPick={setStartId} includeBlank brand={brand} />
                </section>
              ) : (
                <>
                  <section className="flex flex-col gap-3">
                    <SectionTitle hint="Each one becomes a button on the home screen">What should people be able to explore?</SectionTitle>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {STORY_MODULE_KINDS.map((k) => {
                        const on = modules.includes(k);
                        return (
                          <button
                            key={k}
                            type="button"
                            data-plain
                            aria-pressed={on}
                            onClick={() => toggleModule(k)}
                            title={STORY_APP_DESCRIPTIONS[k]}
                            className={`relative flex flex-col gap-1.5 p-3 ${card(on)}`}
                          >
                            <span
                              className={`absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded border ${
                                on ? "border-violet-500 bg-violet-500 text-white" : "border-zinc-300 dark:border-zinc-600"
                              }`}
                            >
                              {on && <Check className="h-3 w-3" strokeWidth={3} />}
                            </span>
                            <Icon d={STORY_APP_ICON[k]} className={on ? "text-violet-500" : "text-zinc-400"} />
                            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">{STORY_APP_LABELS[k]}</span>
                          </button>
                        );
                      })}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                      <input type="checkbox" checked={examples} onChange={(e) => setExamples(e.target.checked)} className="accent-violet-600" />
                      Add sample content I can replace
                    </label>
                  </section>

                  {!brand && (
                    <section className="flex flex-col gap-3">
                      <SectionTitle>Pick a look</SectionTitle>
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
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !isPending && create()}
                placeholder="Name (optional)"
                aria-label="Name"
                className="h-9 w-44 rounded-full border border-border bg-zinc-50 px-3.5 text-xs outline-none focus:border-violet-500 dark:bg-zinc-900"
              />
              <select
                value={sizeId}
                onChange={(e) => setSizeId(e.target.value)}
                aria-label="Screen size"
                className="h-9 rounded-full border border-border bg-zinc-50 px-3 text-xs outline-none focus:border-violet-500 dark:bg-zinc-900"
              >
                {CANVAS_SIZE_PRESETS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
                <option value={CUSTOM}>Custom size…</option>
              </select>
              {sizeId === CUSTOM && (
                <span className="flex items-center gap-1 text-xs text-zinc-500">
                  <input
                    type="number"
                    min={CANVAS_MIN_SIDE}
                    max={CANVAS_MAX_SIDE}
                    value={customW}
                    onChange={(e) => setCustomW(Number(e.target.value))}
                    className="h-9 w-20 rounded-md border border-border bg-zinc-50 px-2 text-xs dark:bg-zinc-900"
                    aria-label="Width"
                  />
                  ×
                  <input
                    type="number"
                    min={CANVAS_MIN_SIDE}
                    max={CANVAS_MAX_SIDE}
                    value={customH}
                    onChange={(e) => setCustomH(Number(e.target.value))}
                    className="h-9 w-20 rounded-md border border-border bg-zinc-50 px-2 text-xs dark:bg-zinc-900"
                    aria-label="Height"
                  />
                </span>
              )}
              <p className="min-w-0 flex-1 truncate text-xs text-red-500">{error}</p>
              <button
                type="button"
                onClick={create}
                disabled={isPending}
                className="ml-auto inline-flex h-9 items-center justify-center gap-2 rounded-full bg-primary px-5 text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
