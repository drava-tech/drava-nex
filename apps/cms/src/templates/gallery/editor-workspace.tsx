"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Check,
  ImageIcon,
  X,
  Plus,
  Copy,
  Trash2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import type { Experience } from "@platform/db";
import { updateExperienceTemplateContent } from "@/actions/experience-actions";
import { MediaPicker } from "@/components/media-picker";
import { ScreenStage } from "@platform/ui/templates/portfolio";
import {
  DEFAULT_GALLERY_CONTENT,
  GalleryView,
  normalizePages,
  normalizePhotos,
  newGalleryPage,
  EXPANDED_PCT_MIN,
  EXPANDED_PCT_MAX,
  DEFAULT_TITLE_FONT_SIZE,
  DEFAULT_SUBTITLE_FONT_SIZE,
  DEFAULT_DESCRIPTION_FONT_SIZE,
  DEFAULT_GAP,
  DEFAULT_PADDING,
  DEFAULT_EXPANDED_PCT,
  type GalleryContent,
  type GalleryPage,
  type GalleryPhoto,
} from "@platform/ui/templates/gallery";

const LABEL = "text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500";
const INPUT =
  "w-full rounded-md border border-border bg-zinc-100 px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-100";
const SECTION_HEAD = "mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400";
const CARD = "flex flex-col gap-3 rounded-xl border border-border p-4";
const ICON_BTN =
  "rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-zinc-800";

/** A labelled control with both a slider and a typed number input — matches the
 *  portfolio editor's NumberControl so the two feel like one product. */
function NumberControl({
  label,
  value,
  min,
  max,
  unit = "px",
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const commit = (raw: number) => {
    if (!Number.isFinite(raw)) return;
    onChange(Math.min(max, Math.max(min, Math.round(raw))));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label className={LABEL}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(e) => commit(Number(e.target.value))}
          className="flex-1 accent-zinc-900 disabled:opacity-50 dark:accent-zinc-100"
        />
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(e) => commit(Number(e.target.value))}
          className="w-16 rounded-md border border-border bg-zinc-100 px-2 py-1 text-right text-xs text-zinc-900 outline-none disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <span className="text-[10px] text-zinc-400">{unit}</span>
      </div>
    </div>
  );
}

/**
 * Full-tab editor for the Gallery template.
 *
 * Content is a list of pages that all share one layout, so the panel is split
 * accordingly: a page list at the top (add / duplicate / reorder / delete), the
 * selected page's own copy and photos below it, and — deliberately last and
 * labelled "all pages" — the style values that apply to every page at once.
 * That arrangement is the point: adding a page can add copy and photos, but
 * never a different design.
 */
export function GalleryEditorWorkspace({
  experience,
  initialContent,
}: {
  experience: Experience;
  initialContent: GalleryContent;
}) {
  const router = useRouter();
  const [content, setContent] = useState<GalleryContent>({
    ...DEFAULT_GALLERY_CONTENT,
    ...initialContent,
    pages: normalizePages(initialContent),
  });
  const [selected, setSelected] = useState(0);
  /**
   * Which picker is open. A numbered slot replaces exactly that photo (one
   * pick, one slot); "fill" opens the multi-select picker and drops each pick
   * into the next empty slot, so four photos take one trip instead of four.
   */
  const [picker, setPicker] = useState<{ mode: "slot"; slot: number } | { mode: "fill" } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pages = content.pages;
  // Guards a selection left dangling by a delete.
  const activeIndex = Math.min(selected, pages.length - 1);
  const page = pages[activeIndex]!;

  const update = (patch: Partial<GalleryContent>) => {
    setSaved(false);
    setContent((c) => ({ ...c, ...patch }));
  };

  const updatePage = (index: number, patch: Partial<GalleryPage>) => {
    setSaved(false);
    setContent((c) => ({
      ...c,
      pages: c.pages.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));
  };

  const updatePhoto = (slot: number, patch: Partial<GalleryPhoto>) => {
    setSaved(false);
    setContent((c) => ({
      ...c,
      pages: c.pages.map((p, i) =>
        i !== activeIndex
          ? p
          : { ...p, photos: normalizePhotos(p.photos).map((ph, s) => (s === slot ? { ...ph, ...patch } : ph)) }
      ),
    }));
  };

  /**
   * Drops a pick into the first empty slot. Reads the slots from the updater's
   * own state rather than the render-time copy, because the multi picker fires
   * this once per click without re-rendering in between — using `photos` here
   * would put every pick in the same slot.
   */
  const fillNextEmpty = (url: string) => {
    setSaved(false);
    setContent((c) => ({
      ...c,
      pages: c.pages.map((p, i) => {
        if (i !== activeIndex) return p;
        const slots = normalizePhotos(p.photos);
        const next = slots.findIndex((ph) => !ph.url);
        // All four taken — ignore further picks rather than silently
        // overwriting work the user already placed.
        if (next === -1) return p;
        return { ...p, photos: slots.map((ph, s) => (s === next ? { ...ph, url } : ph)) };
      }),
    }));
  };

  const addPage = () => {
    setSaved(false);
    setContent((c) => ({ ...c, pages: [...c.pages, newGalleryPage(`Page ${c.pages.length + 1}`)] }));
    setSelected(pages.length);
  };

  /** Duplicating is the fast path for "another one like that" — same layout, new copy. */
  const duplicatePage = (index: number) => {
    setSaved(false);
    setContent((c) => {
      const src = c.pages[index]!;
      const copy: GalleryPage = {
        ...src,
        name: `${src.name} copy`,
        photos: normalizePhotos(src.photos).map((p) => ({ ...p })),
      };
      return { ...c, pages: [...c.pages.slice(0, index + 1), copy, ...c.pages.slice(index + 1)] };
    });
    setSelected(index + 1);
  };

  const deletePage = (index: number) => {
    // normalizePages would resurrect a blank page anyway; refusing here keeps
    // the button honestly disabled instead of appearing to do nothing.
    if (pages.length <= 1) return;
    setSaved(false);
    setContent((c) => ({ ...c, pages: c.pages.filter((_, i) => i !== index) }));
    setSelected((s) => Math.max(0, s > index ? s - 1 : s));
  };

  const movePage = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= pages.length) return;
    setSaved(false);
    setContent((c) => {
      const next = [...c.pages];
      const [moved] = next.splice(index, 1);
      next.splice(to, 0, moved!);
      return { ...c, pages: next };
    });
    setSelected(to);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateExperienceTemplateContent(experience.id, "gallery", content);
      if (res.success) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? "Failed to save.");
      }
    });
  };

  const photos = normalizePhotos(page.photos);

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 text-card-foreground">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/experiences"
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="Back to experiences"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {experience.name}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              Gallery · {page.name} ({activeIndex + 1}/{pages.length})
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/preview/experiences/${experience.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View
          </a>
          <button
            onClick={save}
            disabled={isPending}
            className="flex min-w-[84px] items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
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
        <aside className="w-[400px] shrink-0 overflow-y-auto border-r border-border bg-card p-4 text-card-foreground">
          {/* ─── Pages ─────────────────────────────────────────────────── */}
          <div className="mb-3 flex items-center justify-between">
            <h2 className={`${SECTION_HEAD} mb-0`}>Pages</h2>
            <button
              type="button"
              onClick={addPage}
              disabled={isPending}
              className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <Plus className="h-3 w-3" /> Add page
            </button>
          </div>
          <div className="mb-4 flex flex-col gap-1 rounded-xl border border-border p-2">
            {pages.map((p, i) => (
              <div
                key={i}
                className={`flex items-center gap-1 rounded-lg px-2 py-1.5 ${
                  i === activeIndex
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelected(i)}
                  className="min-w-0 flex-1 truncate text-left text-xs font-medium"
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  onClick={() => movePage(i, -1)}
                  disabled={isPending || i === 0}
                  title="Move up"
                  className={ICON_BTN}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => movePage(i, 1)}
                  disabled={isPending || i === pages.length - 1}
                  title="Move down"
                  className={ICON_BTN}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => duplicatePage(i)}
                  disabled={isPending}
                  title="Duplicate"
                  className={ICON_BTN}
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => deletePage(i)}
                  disabled={isPending || pages.length <= 1}
                  title={pages.length <= 1 ? "A gallery needs at least one page" : "Delete"}
                  className={ICON_BTN}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          {/* ─── Selected page: text ───────────────────────────────────── */}
          <h2 className={SECTION_HEAD}>Text · {page.name}</h2>
          <div className={`${CARD} mb-4`}>
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>Page name (used in the URL)</label>
              <input
                className={INPUT}
                value={page.name}
                disabled={isPending}
                onChange={(e) => updatePage(activeIndex, { name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>Title</label>
              <input
                className={INPUT}
                value={page.title}
                disabled={isPending}
                onChange={(e) => updatePage(activeIndex, { title: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>Subtitle</label>
              <input
                className={INPUT}
                value={page.subtitle ?? ""}
                disabled={isPending}
                onChange={(e) => updatePage(activeIndex, { subtitle: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>Description</label>
              <textarea
                className={`${INPUT} min-h-[96px] resize-y`}
                value={page.description ?? ""}
                disabled={isPending}
                onChange={(e) => updatePage(activeIndex, { description: e.target.value })}
              />
            </div>
          </div>

          {/* ─── Selected page: photos ─────────────────────────────────── */}
          <h2 className={SECTION_HEAD}>Photos · {page.name}</h2>
          <div className={`${CARD} mb-4`}>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Slot 1 is the large feature photo; 2–4 sit in the row below. Upload new images from
              the picker.
            </p>
            <button
              type="button"
              onClick={() => setPicker({ mode: "fill" })}
              disabled={isPending || photos.every((p) => p.url)}
              title={
                photos.every((p) => p.url)
                  ? "All four slots are filled — clear one, or use Replace"
                  : "Pick several at once; each fills the next empty slot"
              }
              className="flex items-center justify-center gap-1.5 rounded-md bg-zinc-100 px-2 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <Plus className="h-3.5 w-3.5" /> Add photos (select several)
            </button>
            {photos.map((photo, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <label className={LABEL}>Photo {i + 1}</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPicker({ mode: "slot", slot: i })}
                    disabled={isPending}
                    className="h-14 w-20 shrink-0 overflow-hidden rounded-md border border-border bg-zinc-100 disabled:opacity-50 dark:bg-zinc-800"
                  >
                    {photo.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-zinc-400">
                        <ImageIcon className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPicker({ mode: "slot", slot: i })}
                      disabled={isPending}
                      className="rounded-md bg-zinc-100 px-2 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    >
                      {photo.url ? "Replace" : "Choose or upload"}
                    </button>
                    <input
                      className={INPUT}
                      placeholder="Caption (optional)"
                      value={photo.caption ?? ""}
                      disabled={isPending}
                      onChange={(e) => updatePhoto(i, { caption: e.target.value })}
                    />
                  </div>
                  {photo.url ? (
                    <button
                      type="button"
                      onClick={() => updatePhoto(i, { url: "" })}
                      disabled={isPending}
                      title="Clear"
                      className={`${ICON_BTN} shrink-0`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {/* ─── Shared style ──────────────────────────────────────────── */}
          <h2 className={SECTION_HEAD}>Style (all pages)</h2>
          <div className={CARD}>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              These apply to every page, so the whole set stays visually identical.
            </p>
            <NumberControl
              label="Title font size"
              value={content.titleFontSize ?? DEFAULT_TITLE_FONT_SIZE}
              min={24}
              max={140}
              disabled={isPending}
              onChange={(v) => update({ titleFontSize: v })}
            />
            <NumberControl
              label="Subtitle font size"
              value={content.subtitleFontSize ?? DEFAULT_SUBTITLE_FONT_SIZE}
              min={10}
              max={64}
              disabled={isPending}
              onChange={(v) => update({ subtitleFontSize: v })}
            />
            <NumberControl
              label="Description font size"
              value={content.descriptionFontSize ?? DEFAULT_DESCRIPTION_FONT_SIZE}
              min={10}
              max={48}
              disabled={isPending}
              onChange={(v) => update({ descriptionFontSize: v })}
            />
            <NumberControl
              label="Gap between photos"
              value={content.gap ?? DEFAULT_GAP}
              min={0}
              max={80}
              disabled={isPending}
              onChange={(v) => update({ gap: v })}
            />
            <NumberControl
              label="Outer margin"
              value={content.padding ?? DEFAULT_PADDING}
              min={0}
              max={200}
              disabled={isPending}
              onChange={(v) => update({ padding: v })}
            />
            <NumberControl
              label="Expanded photo width"
              value={content.expandedPct ?? DEFAULT_EXPANDED_PCT}
              min={EXPANDED_PCT_MIN}
              max={EXPANDED_PCT_MAX}
              unit="%"
              disabled={isPending}
              onChange={(v) => update({ expandedPct: v })}
            />
            <div className="flex items-center gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <label className={LABEL}>Background</label>
                <input
                  type="color"
                  value={content.backgroundColor ?? "#e8e8f7"}
                  disabled={isPending}
                  onChange={(e) => update({ backgroundColor: e.target.value })}
                  className="h-8 w-full cursor-pointer rounded-md border border-border bg-transparent disabled:opacity-50"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <label className={LABEL}>Text</label>
                <input
                  type="color"
                  value={content.textColor ?? "#111114"}
                  disabled={isPending}
                  onChange={(e) => update({ textColor: e.target.value })}
                  className="h-8 w-full cursor-pointer rounded-md border border-border bg-transparent disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</p>}
        </aside>

        <main className="min-w-0 flex-1 bg-zinc-200 p-6 dark:bg-zinc-900/40">
          <ScreenStage variant="fit-screen">
            <GalleryView content={content} pageIndex={activeIndex} />
          </ScreenStage>
        </main>
      </div>

      <MediaPicker
        open={picker !== null}
        accept="image"
        // Only the fill flow stays open across picks; replacing one slot is
        // done the moment a photo is chosen.
        multi={picker?.mode === "fill"}
        onClose={() => setPicker(null)}
        onSelect={(url) => {
          if (!picker) return;
          if (picker.mode === "fill") {
            fillNextEmpty(url);
            return;
          }
          updatePhoto(picker.slot, { url });
          setPicker(null);
        }}
      />
    </div>
  );
}
