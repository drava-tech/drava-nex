"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ImageIcon, Loader2, X } from "lucide-react";
import {
  CANVAS_FONTS,
  CANVAS_MAX_SIDE,
  CANVAS_MIN_SIDE,
  CANVAS_SIZE_PRESETS,
  CanvasThumbnail,
  type CanvasContent,
} from "@platform/ui/templates/canvas";
import { StoryFrame, STORY_APP_DESCRIPTIONS, STORY_APP_ICON, STORY_APP_LABELS, type StoryAppKind } from "@platform/ui/templates/story";
import { createDesign, createStory } from "@/actions/design-actions";
import { MediaPicker } from "@/components/media-picker";
import { onBackground, textOn, toStoryBrand, type BrandKit } from "@/templates/brand";
import type { BrandBookResult } from "@/templates/brand-book/analyse";
import { BrandBookImport, BrandSwatches } from "@/templates/brand-book/brand-book-import";
import { BLANK_TEMPLATE_ID, TemplatePicker, buildTemplate, templateLabel } from "@/templates/canvas/template-picker";
import { STORY_MODULE_KINDS, STORY_PALETTES, STORY_THEMES, composeStory, type StoryScreen } from "@/templates/story/presets";
import "@/templates/canvas/fonts";

const CUSTOM = "custom";

/** The template the brand panel previews itself on. */
const BRAND_PREVIEW_TEMPLATE = "welcome-lobby-hello";

const RADII = [
  { label: "Square", value: 0 },
  { label: "Soft", value: 10 },
  { label: "Rounded", value: 20 },
  { label: "Pill", value: 36 },
] as const;

const TIMEOUTS = [
  { label: "30 seconds", value: 30 },
  { label: "1 minute", value: 60 },
  { label: "2 minutes", value: 120 },
  { label: "5 minutes", value: 300 },
] as const;

const inputCls = "h-8 w-44 rounded-md border border-border bg-zinc-50 px-2 text-xs outline-none focus:border-violet-500 dark:bg-zinc-900";

const thumbStyle = (w: number, h: number): React.CSSProperties =>
  w >= h ? { width: "100%", aspectRatio: `${w} / ${h}` } : { height: "100%", aspectRatio: `${w} / ${h}` };

const card = (active: boolean) =>
  `rounded-xl border text-left transition-colors ${active ? "border-violet-500 bg-violet-500/5" : "border-border hover:border-zinc-400"}`;

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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{title}</span>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[11px] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-zinc-500">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
          aria-label={label}
        />
      </span>
    </Field>
  );
}

function FontField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {CANVAS_FONTS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ImageField({ label, url, cover, onPick, onClear }: { label: string; url: string | null; cover?: boolean; onPick: () => void; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <span className="flex items-center gap-1.5">
        {url && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className={`h-8 w-12 rounded border border-border ${cover ? "object-cover" : "object-contain"}`} />
            <button type="button" data-plain onClick={onClear} aria-label={`Remove ${label.toLowerCase()}`} className="rounded-md p-1.5 text-zinc-500 hover:bg-accent">
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button
          type="button"
          data-plain
          onClick={onPick}
          className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] hover:bg-accent"
        >
          <ImageIcon className="h-3.5 w-3.5" /> {url ? "Change" : "Choose"}
        </button>
      </span>
    </div>
  );
}

export function NewDesignDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [picking, setPicking] = useState<null | "logo" | "background">(null);

  // ① Brand — set once, applied to whatever is made next.
  const [useBrand, setUseBrand] = useState(true);
  const [book, setBook] = useState<BrandBookResult | null>(null);
  const [orgName, setOrgName] = useState("");
  const [tagline, setTagline] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [background, setBackground] = useState(STORY_PALETTES[0]!.brand.background!);
  const [accent, setAccent] = useState(STORY_PALETTES[0]!.brand.accent!);
  const [headingFont, setHeadingFont] = useState<string>(CANVAS_FONTS[0]!.value);
  const [bodyFont, setBodyFont] = useState<string>(CANVAS_FONTS[0]!.value);
  const [radius, setRadius] = useState<number>(20);

  // ② What and how big.
  const [kind, setKind] = useState<"canvas" | "story">("canvas");
  const [name, setName] = useState("");
  const [sizeId, setSizeId] = useState(CANVAS_SIZE_PRESETS[0]!.id);
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);

  // ③ Design: a template. Story: modules, look and screens.
  const [startId, setStartId] = useState(BLANK_TEMPLATE_ID);
  const [modules, setModules] = useState<StoryAppKind[]>(["timeline", "map", "showcase"]);
  const [themeId, setThemeId] = useState(STORY_THEMES[0]!.id);
  const [examples, setExamples] = useState(true);
  const [homeBg, setHomeBg] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("Touch to explore");
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);

  const size =
    sizeId === CUSTOM
      ? {
          width: Math.min(CANVAS_MAX_SIDE, Math.max(CANVAS_MIN_SIDE, Math.round(customW) || 1920)),
          height: Math.min(CANVAS_MAX_SIDE, Math.max(CANVAS_MIN_SIDE, Math.round(customH) || 1080)),
        }
      : CANVAS_SIZE_PRESETS.find((s) => s.id === sizeId)!;

  const kit = useMemo<BrandKit>(() => {
    const p = STORY_PALETTES[paletteIdx]!.brand;
    const colours =
      background === p.background
        ? { background: p.background!, surface: p.surface!, text: p.text!, muted: p.muted! }
        : onBackground(background);
    return { ...colours, name: orgName, tagline, logoUrl, accent, accentText: textOn(accent), headingFont, bodyFont, radius };
  }, [paletteIdx, background, orgName, tagline, logoUrl, accent, headingFont, bodyFont, radius]);
  const brand = useBrand ? kit : null;

  const screen = useMemo<StoryScreen>(
    () => ({ ...(brand ? { name: brand.name, tagline: brand.tagline } : {}), backgroundUrl: homeBg, prompt, timeoutSeconds }),
    [brand, homeBg, prompt, timeoutSeconds]
  );

  const brandPreview = useMemo<CanvasContent>(
    () => ({ version: 1, width: size.width, height: size.height, pages: [buildTemplate(BRAND_PREVIEW_TEMPLATE, size.width, size.height, kit)] }),
    [kit, size.width, size.height]
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
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">New {kind === "story" ? "story" : "design"}</h2>
          <button type="button" data-plain onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-500 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto p-5 [scrollbar-gutter:stable]">
          {/* ① Brand */}
          <section className="flex flex-col gap-3">
            <StepLabel n={1}>Brand</StepLabel>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  [true, "Your brand", "Your logo, colours and fonts on every template and story."],
                  [false, "No brand", "Use each template's own look, or a signature story theme."],
                ] as const
              ).map(([on, label, desc]) => (
                <button key={label} type="button" data-plain onClick={() => setUseBrand(on)} className={`p-3.5 ${card(useBrand === on)}`}>
                  <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50">{label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{desc}</span>
                </button>
              ))}
            </div>

            {useBrand && (
              <BrandBookImport
                onResult={setBook}
                onApply={(f) => {
                  if (f.name !== undefined) setOrgName(f.name);
                  if (f.tagline !== undefined) setTagline(f.tagline);
                  if (f.background) setBackground(f.background);
                  if (f.accent) setAccent(f.accent);
                  if (f.headingFont) setHeadingFont(f.headingFont);
                  if (f.bodyFont) setBodyFont(f.bodyFont);
                  if (f.logoUrl) setLogoUrl(f.logoUrl);
                }}
              />
            )}

            {useBrand && (
              <div className="grid gap-5 rounded-xl border border-border p-4 sm:grid-cols-[1fr_1fr_0.9fr]">
                <div className="flex flex-col gap-5">
                  <Group title="Identity">
                    <Field label="Organisation">
                      <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Northwind Holdings" className={inputCls} />
                    </Field>
                    <Field label="Tagline">
                      <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Fifty years of craft" className={inputCls} />
                    </Field>
                    <ImageField label="Logo" url={logoUrl} onPick={() => setPicking("logo")} onClear={() => setLogoUrl(null)} />
                  </Group>
                  <Group title="Type & shape">
                    <FontField label="Heading font" value={headingFont} onChange={setHeadingFont} />
                    <FontField label="Body font" value={bodyFont} onChange={setBodyFont} />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-zinc-500">Corners</span>
                      <span className="flex w-44 gap-1">
                        {RADII.map((r) => (
                          <button
                            key={r.value}
                            type="button"
                            data-plain
                            title={r.label}
                            aria-label={r.label}
                            aria-pressed={radius === r.value}
                            onClick={() => setRadius(r.value)}
                            className={`flex h-8 flex-1 items-center justify-center rounded-md border ${
                              radius === r.value ? "border-violet-500 bg-violet-500/5" : "border-border hover:border-zinc-400"
                            }`}
                          >
                            <span className="h-3.5 w-5 border-2 border-zinc-500" style={{ borderRadius: Math.min(r.value / 3, 7) }} />
                          </button>
                        ))}
                      </span>
                    </div>
                  </Group>
                </div>

                <Group title={book?.colours.length ? "Colours · from your brand book" : "Colours"}>
                  {book?.colours.length ? (
                    <>
                      <BrandSwatches
                        colours={book.colours}
                        background={background}
                        accent={accent}
                        onPick={(f) => {
                          if (f.background) setBackground(f.background);
                          if (f.accent) setAccent(f.accent);
                        }}
                      />
                      {(background !== book.suggestion.background || accent !== book.suggestion.accent) && (
                        <button
                          type="button"
                          data-plain
                          onClick={() => {
                            setBackground(book.suggestion.background);
                            setAccent(book.suggestion.accent);
                          }}
                          className="self-start text-[11px] text-violet-500 underline-offset-2 hover:underline"
                        >
                          Reset to the brand book&apos;s picks
                        </button>
                      )}
                    </>
                  ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {STORY_PALETTES.map((p, i) => (
                      <button
                        key={p.label}
                        type="button"
                        data-plain
                        onClick={() => {
                          setPaletteIdx(i);
                          setAccent(p.brand.accent!);
                          setBackground(p.brand.background!);
                        }}
                        className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 text-[10px] ${
                          paletteIdx === i && background === p.brand.background ? "border-violet-500" : "border-border hover:border-zinc-400"
                        }`}
                      >
                        <span className="flex h-7 w-full overflow-hidden rounded" style={{ background: p.brand.background }}>
                          <span className="m-1 w-1/2 rounded-sm" style={{ background: p.brand.surface }} />
                          <span className="my-2 mr-1 h-3 w-3 rounded-full" style={{ background: p.brand.accent }} />
                        </span>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  )}
                  <ColourField label="Background" value={background} onChange={setBackground} />
                  <ColourField label="Accent colour" value={accent} onChange={setAccent} />
                </Group>

                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Preview</span>
                  <div className="flex h-36 items-center justify-center rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
                    <CanvasThumbnail content={brandPreview} className="max-h-full max-w-full rounded-sm border border-border" style={thumbStyle(size.width, size.height)} />
                  </div>
                  <p className="text-[11px] leading-snug text-zinc-500">Every template below is redrawn in this brand. Fine-tune anything later in the editor.</p>
                </div>
              </div>
            )}
          </section>

          {/* ② What to make */}
          <section className="flex flex-col gap-4">
            <StepLabel n={2}>What are you making?</StepLabel>
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
            /* ③ Design: a template, in the brand or in its own theme */
            <section className="flex flex-col gap-2">
              <StepLabel n={3} hint={brand ? "Shown in your brand" : "Shown in each template's own theme"}>
                Start from a template
              </StepLabel>
              <TemplatePicker width={size.width} height={size.height} value={startId} onPick={setStartId} includeBlank brand={brand} />
            </section>
          ) : (
            <>
              {/* ③ Story modules */}
              <section className="flex flex-col gap-2">
                <StepLabel n={3} hint={`${modules.length} selected · each becomes a tile on the home menu`}>
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

              {/* ④ Story look and screens */}
              <section className="flex flex-col gap-3">
                <StepLabel n={4} hint={brand ? "In your brand" : "Pick a signature theme"}>
                  {brand ? "Screens" : "Theme & screens"}
                </StepLabel>
                {!brand && (
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
                )}
                <div className={`grid gap-4 ${branded ? "sm:grid-cols-[1fr_1.2fr]" : ""}`}>
                  <div className="flex flex-col gap-2.5">
                    <ImageField label="Background image" url={homeBg} cover onPick={() => setPicking("background")} onClear={() => setHomeBg(null)} />
                    <Field label="Idle prompt">
                      <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Touch to explore" className={inputCls} />
                    </Field>
                    <Field label="Back to idle after">
                      <select value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(Number(e.target.value))} className={inputCls}>
                        {TIMEOUTS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label} without a touch
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  {branded && (
                    <div className="flex h-56 items-center justify-center rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
                      <StoryFrame content={branded.content} still className="max-h-full max-w-full rounded-sm" style={thumbStyle(size.width, size.height)} />
                    </div>
                  )}
                </div>
              </section>
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

      <div onClick={(e) => e.stopPropagation()}>
        <MediaPicker
          open={picking !== null}
          onClose={() => setPicking(null)}
          accept="image"
          onSelect={(url) => {
            if (picking === "logo") setLogoUrl(url);
            else setHomeBg(url);
            setPicking(null);
          }}
        />
      </div>
    </div>
  );
}
