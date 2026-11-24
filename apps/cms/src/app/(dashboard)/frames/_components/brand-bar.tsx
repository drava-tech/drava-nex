"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Palette, Plus, Trash2, X } from "lucide-react";
import { CANVAS_FONTS, CanvasThumbnail, type CanvasContent } from "@platform/ui/templates/canvas";
import { MediaPicker } from "@/components/media-picker";
import { onBackground, textOn, type BrandKit } from "@/templates/brand";
import type { BrandBookResult } from "@/templates/brand-book/analyse";
import { BrandBookImport, BrandSwatches } from "@/templates/brand-book/brand-book-import";
import { buildTemplate } from "@/templates/canvas/template-picker";
import { STORY_PALETTES } from "@/templates/story/presets";
import { ColourField, Field, FontField, Group, ImageField, inputCls, thumbStyle } from "./form-fields";

/** The template the brand panel previews itself on. */
const BRAND_PREVIEW_TEMPLATE = "welcome-lobby-hello";
const PREVIEW_W = 1920;
const PREVIEW_H = 1080;
const STORAGE_KEY = "nex.frames.brands.v2";
/** The single-brand format this replaced; read once and carried over. */
const LEGACY_KEY = "nex.frames.brand.v1";

const RADII = [
  { label: "Square", value: 0 },
  { label: "Soft", value: 10 },
  { label: "Rounded", value: 20 },
  { label: "Pill", value: 36 },
] as const;

/** One saved brand. */
export interface BrandProfile {
  id: string;
  orgName: string;
  tagline: string;
  logoUrl: string | null;
  paletteIdx: number;
  background: string;
  accent: string;
  headingFont: string;
  bodyFont: string;
  radius: number;
  /** Colours read from an uploaded brand book; they replace the preset palettes. */
  book: Pick<BrandBookResult, "colours" | "suggestion"> | null;
}

/** The Frames screen's saved brands, per browser. `activeId` null means No brand. */
interface BrandLibraryState {
  brands: BrandProfile[];
  activeId: string | null;
}

const newId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function blankProfile(i = 0): BrandProfile {
  const idx = i % STORY_PALETTES.length;
  const p = STORY_PALETTES[idx]!.brand;
  return {
    id: newId(),
    orgName: "",
    tagline: "",
    logoUrl: null,
    paletteIdx: idx,
    background: p.background!,
    accent: p.accent!,
    headingFont: CANVAS_FONTS[0]!.value,
    bodyFont: CANVAS_FONTS[0]!.value,
    radius: 20,
    book: null,
  };
}

function readStored(): BrandLibraryState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const v = JSON.parse(raw) as Partial<BrandLibraryState>;
    const brands = (v.brands ?? []).map((b) => ({ ...blankProfile(), ...b }));
    const activeId = brands.some((b) => b.id === v.activeId) ? v.activeId! : null;
    return { brands, activeId };
  }
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    const { useBrand, ...rest } = JSON.parse(legacy) as Partial<BrandProfile> & { useBrand?: boolean };
    const b: BrandProfile = { ...blankProfile(), ...rest, id: newId() };
    return { brands: [b], activeId: useBrand === false ? null : b.id };
  }
  return null;
}

export function kitOf(b: BrandProfile): BrandKit {
  const p = STORY_PALETTES[b.paletteIdx]?.brand ?? STORY_PALETTES[0]!.brand;
  const colours =
    b.background === p.background ? { background: p.background!, surface: p.surface!, text: p.text!, muted: p.muted! } : onBackground(b.background);
  return {
    ...colours,
    name: b.orgName,
    tagline: b.tagline,
    logoUrl: b.logoUrl,
    accent: b.accent,
    accentText: textOn(b.accent),
    headingFont: b.headingFont,
    bodyFont: b.bodyFont,
    radius: b.radius,
  };
}

/** Saved brands and which one is in use, kept in this browser between visits. */
export function useBrandLibrary() {
  const [state, setState] = useState<BrandLibraryState>({ brands: [], activeId: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = readStored();
      if (stored) setState(stored);
    } catch {
      /* private window or bad data: start empty */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked: the brands just won't be remembered */
    }
  }, [state, loaded]);

  const select = useCallback((id: string | null) => setState((s) => ({ ...s, activeId: id })), []);

  const add = useCallback(
    () =>
      setState((s) => {
        const b = blankProfile(s.brands.length);
        return { brands: [...s.brands, b], activeId: b.id };
      }),
    []
  );

  const remove = useCallback(
    (id: string) =>
      setState((s) => {
        const brands = s.brands.filter((b) => b.id !== id);
        return { brands, activeId: s.activeId === id ? (brands[0]?.id ?? null) : s.activeId };
      }),
    []
  );

  const updateActive = useCallback(
    (patch: Partial<BrandProfile>) =>
      setState((s) => ({ ...s, brands: s.brands.map((b) => (b.id === s.activeId ? { ...b, ...patch, id: b.id } : b)) })),
    []
  );

  const active = state.brands.find((b) => b.id === state.activeId) ?? null;
  const brand = useMemo(() => (active ? kitOf(active) : null), [active]);

  return { brands: state.brands, active, brand, select, add, remove, updateActive };
}

export type BrandLibrary = ReturnType<typeof useBrandLibrary>;

const chipCls = (active: boolean) =>
  `flex h-8 items-center gap-2 rounded-full border text-xs font-medium transition-colors ${
    active ? "border-violet-500 bg-violet-500/10 text-zinc-900 dark:text-zinc-50" : "border-border text-zinc-600 hover:border-zinc-400 dark:text-zinc-300"
  }`;

function BrandChip({ b, active, onClick, onDelete }: { b: BrandProfile; active: boolean; onClick: () => void; onDelete: () => void }) {
  const k = kitOf(b);
  const [confirming, setConfirming] = useState(false);
  const label = b.orgName.trim() || "Unnamed brand";

  if (confirming) {
    return (
      <span className="flex h-8 items-center gap-1 rounded-full border border-red-400/60 bg-red-500/5 pl-3 pr-1 text-xs">
        <span className="max-w-[140px] truncate text-zinc-600 dark:text-zinc-300">Delete {label}?</span>
        <button
          type="button"
          data-plain
          onClick={() => {
            setConfirming(false);
            onDelete();
          }}
          className="h-6 rounded-full bg-red-600 px-2.5 text-[11px] font-semibold text-white hover:bg-red-700"
        >
          Delete
        </button>
        <button type="button" data-plain onClick={() => setConfirming(false)} className="h-6 rounded-full px-2 text-[11px] text-zinc-500 hover:bg-accent">
          Keep
        </button>
      </span>
    );
  }

  return (
    <span className={`group max-w-[220px] pl-1 pr-1 ${chipCls(active)}`}>
      <button type="button" data-plain onClick={onClick} aria-pressed={active} className="flex min-w-0 items-center gap-2">
        {b.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.logoUrl} alt="" className="h-6 w-6 shrink-0 rounded-full object-contain p-0.5" style={{ background: k.background }} />
        ) : (
          <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full border border-border" style={{ background: k.background }}>
            <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full" style={{ background: k.accent }} />
          </span>
        )}
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        data-plain
        onClick={() => setConfirming(true)}
        title={`Delete ${label}`}
        aria-label={`Delete ${label}`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-red-500/10 hover:text-red-600"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/**
 * The Frames screen's brands. Pick one (or No brand) and everything created
 * from here, Design templates and Stories, follows it.
 */
export function BrandBar({ lib }: { lib: BrandLibrary }) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const s = lib.active;
  const update = lib.updateActive;
  const kit = lib.brand;

  const preview = useMemo<CanvasContent | null>(
    () => (kit ? { version: 1, width: PREVIEW_W, height: PREVIEW_H, pages: [buildTemplate(BRAND_PREVIEW_TEMPLATE, PREVIEW_W, PREVIEW_H, kit)] } : null),
    [kit]
  );

  const choose = (id: string | null) => {
    lib.select(id);
    setConfirmRemove(false);
    if (!id) setOpen(false);
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-3 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-2 pl-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
          <Palette className="h-3.5 w-3.5" /> Brand
        </span>
        <button type="button" data-plain onClick={() => choose(null)} aria-pressed={!s} className={`px-3 ${chipCls(!s)}`}>
          No brand
        </button>
        {lib.brands.map((b) => (
          <BrandChip
            key={b.id}
            b={b}
            active={s?.id === b.id}
            onClick={() => choose(b.id)}
            onDelete={() => {
              if (s?.id === b.id) setOpen(false);
              lib.remove(b.id);
            }}
          />
        ))}
        <button
          type="button"
          data-plain
          onClick={() => {
            lib.add();
            setConfirmRemove(false);
            setOpen(true);
          }}
          className="flex h-8 items-center gap-1 rounded-full border border-dashed border-border px-3 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100"
        >
          <Plus className="h-3.5 w-3.5" /> New brand
        </button>

        {s ? (
          <button
            type="button"
            data-plain
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="ml-auto flex h-7 items-center gap-1 rounded-full border border-border px-3 text-[11px] font-medium hover:bg-accent"
          >
            {open ? "Done" : "Edit brand"}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        ) : (
          <span className="ml-auto text-[11px] text-zinc-500">New designs use each template&apos;s own look; stories use a signature theme.</span>
        )}
      </div>

      {s && kit && preview && open && (
        <div className="flex flex-col gap-3">
          <BrandBookImport
            key={s.id}
            onResult={(r) => {
              if (r) update({ book: { colours: r.colours, suggestion: r.suggestion } });
            }}
            onApply={(f) => {
              const p: Partial<BrandProfile> = {};
              if (f.name !== undefined) p.orgName = f.name;
              if (f.tagline !== undefined) p.tagline = f.tagline;
              if (f.background) p.background = f.background;
              if (f.accent) p.accent = f.accent;
              if (f.headingFont) p.headingFont = f.headingFont;
              if (f.bodyFont) p.bodyFont = f.bodyFont;
              if (f.logoUrl) p.logoUrl = f.logoUrl;
              update(p);
            }}
          />

          <div className="grid gap-5 rounded-xl border border-border p-4 sm:grid-cols-[1fr_1fr_0.9fr]">
            <div className="flex flex-col gap-5">
              <Group title="Identity">
                <Field label="Organisation">
                  <input value={s.orgName} onChange={(e) => update({ orgName: e.target.value })} placeholder="e.g. Northwind Holdings" className={inputCls} />
                </Field>
                <Field label="Tagline">
                  <input value={s.tagline} onChange={(e) => update({ tagline: e.target.value })} placeholder="e.g. Fifty years of craft" className={inputCls} />
                </Field>
                <ImageField label="Logo" url={s.logoUrl} onPick={() => setPicking(true)} onClear={() => update({ logoUrl: null })} />
              </Group>
              <Group title="Type & shape">
                <FontField label="Heading font" value={s.headingFont} onChange={(v) => update({ headingFont: v })} />
                <FontField label="Body font" value={s.bodyFont} onChange={(v) => update({ bodyFont: v })} />
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
                        aria-pressed={s.radius === r.value}
                        onClick={() => update({ radius: r.value })}
                        className={`flex h-8 flex-1 items-center justify-center rounded-md border ${
                          s.radius === r.value ? "border-violet-500 bg-violet-500/5" : "border-border hover:border-zinc-400"
                        }`}
                      >
                        <span className="h-3.5 w-5 border-2 border-zinc-500" style={{ borderRadius: Math.min(r.value / 3, 7) }} />
                      </button>
                    ))}
                  </span>
                </div>
              </Group>
            </div>

            <Group title={s.book?.colours.length ? "Colours · from your brand book" : "Colours"}>
              {s.book?.colours.length ? (
                <>
                  <BrandSwatches
                    colours={s.book.colours}
                    background={s.background}
                    accent={s.accent}
                    onPick={(f) => update({ ...(f.background ? { background: f.background } : {}), ...(f.accent ? { accent: f.accent } : {}) })}
                  />
                  {(s.background !== s.book.suggestion.background || s.accent !== s.book.suggestion.accent) && (
                    <button
                      type="button"
                      data-plain
                      onClick={() => update({ background: s.book!.suggestion.background, accent: s.book!.suggestion.accent })}
                      className="self-start text-[11px] text-violet-500 underline-offset-2 hover:underline"
                    >
                      Reset to the brand book&apos;s picks
                    </button>
                  )}
                  <button
                    type="button"
                    data-plain
                    onClick={() => update({ book: null })}
                    className="self-start text-[11px] text-zinc-500 underline-offset-2 hover:underline"
                  >
                    Use preset palettes instead
                  </button>
                </>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {STORY_PALETTES.map((p, i) => (
                    <button
                      key={p.label}
                      type="button"
                      data-plain
                      onClick={() => update({ paletteIdx: i, accent: p.brand.accent!, background: p.brand.background! })}
                      className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 text-[10px] ${
                        s.paletteIdx === i && s.background === p.brand.background ? "border-violet-500" : "border-border hover:border-zinc-400"
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
              <ColourField label="Background" value={s.background} onChange={(v) => update({ background: v })} />
              <ColourField label="Accent colour" value={s.accent} onChange={(v) => update({ accent: v })} />
            </Group>

            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Preview</span>
              <div className="flex h-36 items-center justify-center rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
                <CanvasThumbnail content={preview} className="max-h-full max-w-full rounded-sm border border-border" style={thumbStyle(PREVIEW_W, PREVIEW_H)} />
              </div>
              <p className="text-[11px] leading-snug text-zinc-500">While this brand is selected, every new design and story is made in it. Fine-tune anything later in the editor.</p>
              <div className="mt-auto flex items-center gap-2 pt-2">
                {confirmRemove ? (
                  <>
                    <span className="text-[11px] text-zinc-500">Delete this brand?</span>
                    <button
                      type="button"
                      data-plain
                      onClick={() => {
                        lib.remove(s.id);
                        setConfirmRemove(false);
                        setOpen(false);
                      }}
                      className="h-7 rounded-full bg-red-600 px-3 text-[11px] font-semibold text-white hover:bg-red-700"
                    >
                      Delete
                    </button>
                    <button type="button" data-plain onClick={() => setConfirmRemove(false)} className="h-7 rounded-full px-2 text-[11px] text-zinc-500 hover:bg-accent">
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    data-plain
                    onClick={() => setConfirmRemove(true)}
                    className="flex h-7 items-center gap-1.5 rounded-full px-2 text-[11px] text-zinc-500 hover:bg-accent hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete brand
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <MediaPicker
        open={picking}
        onClose={() => setPicking(false)}
        accept="image"
        onSelect={(url) => {
          update({ logoUrl: url });
          setPicking(false);
        }}
      />
    </section>
  );
}
