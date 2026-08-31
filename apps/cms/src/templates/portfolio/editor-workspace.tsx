"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Check } from "lucide-react";
import type { Experience } from "@platform/db";
import { updateExperienceTemplateContent } from "@/actions/experience-actions";
import { PortfolioFields, SectionFields } from "./editor-fields";
import {
  ScreenStage,
  PortfolioApp,
  DEFAULT_PORTFOLIO_CONTENT,
  DEFAULT_TITLE_FONT_SIZE,
  DEFAULT_BUTTON_FONT_SIZE,
  DEFAULT_CARD_PADDING,
  normalizeSections,
  DEFAULT_PORTFOLIO_GALLERY_STYLE,
  GALLERY_EXPANDED_PCT_MIN,
  GALLERY_EXPANDED_PCT_MAX,
  type OverviewCard,
  type PortfolioContent,
  type PortfolioGalleryStyle,
  type PortfolioSection,
  type PortfolioViewState,
} from "@platform/ui/templates/portfolio";

function clampNum(v: number, min: number, max: number) {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/** A labelled control with both a slider and a typed number input. */
function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "px",
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Most values here are pixels; the gallery's expanded width is a percentage. */
  unit?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(clampNum(Number(e.target.value), min, max))}
          className="flex-1 accent-zinc-900 dark:accent-zinc-100"
        />
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(clampNum(Number(e.target.value), min, max))}
            className="w-16 bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1 text-xs text-right text-zinc-900 dark:text-zinc-100 outline-none disabled:opacity-50"
          />
          <span className="text-[10px] text-zinc-400">{unit}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Full-tab content editor for the Portfolio template (Shopify-style): a content
 * panel on the left, a live 1920×1080 preview on the right, and Save in the top bar.
 */
export function PortfolioEditorWorkspace({
  experience,
  initialContent,
}: {
  experience: Experience;
  initialContent: PortfolioContent;
}) {
  const router = useRouter();
  const seed = initialContent?.overview?.cards?.length
    ? initialContent.overview.cards
    : DEFAULT_PORTFOLIO_CONTENT.overview.cards;

  const [cards, setCards] = useState<OverviewCard[]>(
    seed.map((c) => ({ ...c, sections: normalizeSections(c.sections) }))
  );
  const [titleFontSize, setTitleFontSize] = useState<number>(
    initialContent?.overview?.titleFontSize ?? DEFAULT_TITLE_FONT_SIZE
  );
  const [buttonFontSize, setButtonFontSize] = useState<number>(
    initialContent?.overview?.buttonFontSize ?? DEFAULT_BUTTON_FONT_SIZE
  );
  const [cardPadding, setCardPadding] = useState<number>(
    initialContent?.overview?.cardPadding ?? DEFAULT_CARD_PADDING
  );
  const [gallery, setGallery] = useState<PortfolioGalleryStyle>(
    initialContent?.gallery ?? DEFAULT_PORTFOLIO_GALLERY_STYLE
  );
  const [editorView, setEditorView] = useState<PortfolioViewState>({
    cardIndex: null,
    sectionIndex: null,
  });

  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const content: PortfolioContent = {
    gallery,
    overview: { cards, titleFontSize, buttonFontSize, cardPadding },
  };

  const updateGallery = (patch: Partial<PortfolioGalleryStyle>) => {
    setSaved(false);
    setGallery((g) => ({ ...g, ...patch }));
  };

  const onChange = (index: number, key: keyof OverviewCard, value: string) => {
    setSaved(false);
    setCards((prev) => prev.map((c, idx) => (idx === index ? { ...c, [key]: value } : c)));
  };

  const onSectionChange = (
    cardIndex: number,
    sectionIndex: number,
    patch: Partial<PortfolioSection>
  ) => {
    setSaved(false);
    setCards((prev) =>
      prev.map((c, i) =>
        i !== cardIndex
          ? c
          : {
              ...c,
              sections: normalizeSections(c.sections).map((s, si) =>
                si === sectionIndex ? { ...s, ...patch } : s
              ),
            }
      )
    );
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateExperienceTemplateContent(experience.id, "portfolio", content);
      if (res.success) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? "Failed to save.");
      }
    });
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-zinc-100 dark:bg-zinc-950">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-3 px-4 h-14 shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/experiences"
            className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
            title="Back to experiences"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {experience.name}
            </p>
            <p className="text-[11px] text-zinc-400">Portfolio · Overview</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/preview/experiences/${experience.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View
          </a>
          <button
            onClick={save}
            disabled={isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs font-bold disabled:opacity-50 min-w-[84px] justify-center"
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

      {/* Body: content panel + live preview */}
      <div className="flex-1 flex min-h-0">
        <aside className="w-[400px] shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-y-auto p-4">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400 mb-3">
            Content
          </h2>

          {editorView.cardIndex !== null && cards[editorView.cardIndex] ? (
            <div className="flex flex-col gap-4">
              <button
                onClick={() => setEditorView({ cardIndex: null, sectionIndex: null })}
                className="flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors w-fit"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Overview
              </button>

              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Editing: {cards[editorView.cardIndex]?.title}
              </p>

              <SectionFields
                card={cards[editorView.cardIndex]!}
                cardIndex={editorView.cardIndex}
                allCards={cards}
                disabled={isPending}
                onSectionChange={onSectionChange}
              />

              {/* Shown here rather than on the overview because this is where
                  gallery sections are configured. One set of values for every
                  gallery section, so they all stay visually identical. */}
              <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                  Gallery style (all gallery sections)
                </h3>
                <NumberControl
                  label="Title font size"
                  value={gallery.titleFontSize ?? DEFAULT_PORTFOLIO_GALLERY_STYLE.titleFontSize}
                  min={24}
                  max={140}
                  disabled={isPending}
                  onChange={(v) => updateGallery({ titleFontSize: v })}
                />
                <NumberControl
                  label="Subtitle font size"
                  value={gallery.subtitleFontSize ?? DEFAULT_PORTFOLIO_GALLERY_STYLE.subtitleFontSize}
                  min={10}
                  max={64}
                  disabled={isPending}
                  onChange={(v) => updateGallery({ subtitleFontSize: v })}
                />
                <NumberControl
                  label="Description font size"
                  value={gallery.descriptionFontSize ?? DEFAULT_PORTFOLIO_GALLERY_STYLE.descriptionFontSize}
                  min={10}
                  max={48}
                  disabled={isPending}
                  onChange={(v) => updateGallery({ descriptionFontSize: v })}
                />
                <NumberControl
                  label="Gap between photos"
                  value={gallery.gap ?? DEFAULT_PORTFOLIO_GALLERY_STYLE.gap}
                  min={0}
                  max={80}
                  disabled={isPending}
                  onChange={(v) => updateGallery({ gap: v })}
                />
                <NumberControl
                  label="Outer margin"
                  value={gallery.padding ?? DEFAULT_PORTFOLIO_GALLERY_STYLE.padding}
                  min={0}
                  max={200}
                  disabled={isPending}
                  onChange={(v) => updateGallery({ padding: v })}
                />
                <NumberControl
                  label="Expanded photo width"
                  value={gallery.expandedPct ?? DEFAULT_PORTFOLIO_GALLERY_STYLE.expandedPct}
                  min={GALLERY_EXPANDED_PCT_MIN}
                  max={GALLERY_EXPANDED_PCT_MAX}
                  unit="%"
                  disabled={isPending}
                  onChange={(v) => updateGallery({ expandedPct: v })}
                />
                <div className="flex items-center gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500">
                      Background
                    </label>
                    <input
                      type="color"
                      value={gallery.backgroundColor ?? DEFAULT_PORTFOLIO_GALLERY_STYLE.backgroundColor}
                      disabled={isPending}
                      onChange={(e) => updateGallery({ backgroundColor: e.target.value })}
                      className="h-8 w-full cursor-pointer rounded-md border border-zinc-300 bg-transparent disabled:opacity-50 dark:border-zinc-700"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500">
                      Text
                    </label>
                    <input
                      type="color"
                      value={gallery.textColor ?? DEFAULT_PORTFOLIO_GALLERY_STYLE.textColor}
                      disabled={isPending}
                      onChange={(e) => updateGallery({ textColor: e.target.value })}
                      className="h-8 w-full cursor-pointer rounded-md border border-zinc-300 bg-transparent disabled:opacity-50 dark:border-zinc-700"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Style — one set of values shared by all 3 cards */}
              <div className="flex flex-col gap-4 mb-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                  Style (all cards)
                </h3>
                <NumberControl
                  label="Title font size"
                  value={titleFontSize}
                  min={24}
                  max={120}
                  disabled={isPending}
                  onChange={(v) => { setSaved(false); setTitleFontSize(v); }}
                />
                <NumberControl
                  label="Button font size"
                  value={buttonFontSize}
                  min={10}
                  max={48}
                  disabled={isPending}
                  onChange={(v) => { setSaved(false); setButtonFontSize(v); }}
                />
                <NumberControl
                  label="Card padding (spacing)"
                  value={cardPadding}
                  min={0}
                  max={120}
                  disabled={isPending}
                  onChange={(v) => { setSaved(false); setCardPadding(v); }}
                />
              </div>

              <PortfolioFields cards={cards} disabled={isPending} onChange={onChange} />
            </>
          )}

          {error && <p className="text-xs text-red-500 dark:text-red-400 mt-3">{error}</p>}
        </aside>

        <main className="flex-1 min-w-0 p-6 bg-zinc-200 dark:bg-zinc-900/40">
          <ScreenStage variant="fit-screen">
            <PortfolioApp content={content} view={editorView} onNavigate={setEditorView} />
          </ScreenStage>
        </main>
      </div>
    </div>
  );
}
