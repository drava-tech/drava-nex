"use client";

import { ChevronLeft } from "lucide-react";
import { GalleryView } from "../../gallery/gallery-view";
import type { GalleryContent } from "../../gallery/content";
import {
  DEFAULT_PORTFOLIO_GALLERY_STYLE,
  GALLERY_PHOTO_COUNT,
  type PortfolioGalleryStyle,
  type PortfolioSection,
} from "../content";

/**
 * A section whose type is "gallery" — what the split-view slider commits into
 * instead of a slideshow: the section's text beside its first four photos, where
 * tapping a photo expands it over most of the screen and blurs the rest.
 *
 * The layout and interaction are the Gallery template's, reused wholesale rather
 * than reimplemented — one expand/blur behaviour, one place to change it. This
 * only adapts a portfolio section into the shape that component reads.
 *
 * Photos come from the section's existing `images`, so a section already filled
 * in as a slideshow shows something the moment its type is switched.
 */
/** Back button geometry, shared with the text clearance below. */
const BACK_TOP = 36;
const BACK_LEFT = 48;
const BACK_SIZE = 64;
/** Breathing room between the button and the title beneath it. */
const BACK_GAP = 20;

export function GallerySectionView({
  section,
  style,
  onBack,
}: {
  section: PortfolioSection;
  style?: PortfolioGalleryStyle;
  onBack: () => void;
}) {
  const s = { ...DEFAULT_PORTFOLIO_GALLERY_STYLE, ...(style ?? {}) };

  // The button floats over the layout's top-left corner, which is exactly where
  // the title starts. Push the text down by however much the button overhangs
  // the layout's own top padding — derived rather than hardcoded, so changing
  // the outer margin in the editor can't reintroduce the overlap.
  const textTopInset = Math.max(0, BACK_TOP + BACK_SIZE + BACK_GAP - s.padding);

  const content: GalleryContent = {
    titleFontSize: s.titleFontSize,
    subtitleFontSize: s.subtitleFontSize,
    descriptionFontSize: s.descriptionFontSize,
    gap: s.gap,
    padding: s.padding,
    backgroundColor: s.backgroundColor,
    textColor: s.textColor,
    expandedPct: s.expandedPct,
    blurPx: s.blurPx,
    pages: [
      {
        name: section.name,
        title: (section.title ?? "").trim() || section.name,
        ...(section.subtitle ? { subtitle: section.subtitle } : {}),
        ...(section.description ? { description: section.description } : {}),
        // GalleryView pads/truncates to exactly four slots itself.
        photos: (section.images ?? []).slice(0, GALLERY_PHOTO_COUNT).map((url) => ({ url })),
      },
    ],
  };

  return (
    <div className="w-full h-full relative" style={{ overflow: "hidden" }}>
      <GalleryView content={content} pageIndex={0} topInset={textTopInset} />

      {/* Back button floats over the layout, matching VerticalView's placement
          so the two section types feel like the same page. */}
      <button
        onClick={onBack}
        className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
        style={{
          position: "absolute",
          top: BACK_TOP,
          left: BACK_LEFT,
          zIndex: 10,
          background: "rgba(0, 0, 0, 0.45)",
          color: "#f2f2f2",
          border: "none",
          borderRadius: 999,
          width: BACK_SIZE,
          height: BACK_SIZE,
        }}
        title="Go back"
      >
        <ChevronLeft size={36} />
      </button>
    </div>
  );
}
