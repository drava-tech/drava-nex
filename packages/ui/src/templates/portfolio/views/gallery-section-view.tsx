"use client";

import { ChevronLeft } from "lucide-react";
import { GalleryView, type GalleryLink } from "../../gallery/gallery-view";
import type { GalleryContent } from "../../gallery/content";
import {
  DEFAULT_PORTFOLIO_GALLERY_STYLE,
  GALLERY_PHOTO_COUNT,
  type PortfolioGalleryStyle,
  type PortfolioProject,
  type PortfolioSection,
} from "../content";

/**
 * A section whose type is "gallery" — what the split-view slider commits into
 * instead of a slideshow: one company's text beside its first four photos, where
 * tapping a photo expands it over most of the screen and blurs the rest.
 *
 * The layout and interaction are the Gallery template's, reused wholesale rather
 * than reimplemented — one expand/blur behaviour, one place to change it. This
 * only adapts a portfolio project into the shape that component reads.
 *
 * Copy and photos come from the `project`, which for a category authored before
 * companies existed is the section's own flat fields, migrated by
 * normalizeSections — so those pages look exactly as they did.
 */
/** Back button geometry, shared with the text clearance below. */
const BACK_TOP = 36;
const BACK_LEFT = 48;
const BACK_SIZE = 64;
/** Breathing room between the button and the title beneath it. */
const BACK_GAP = 20;

export function GallerySectionView({
  section,
  project,
  style,
  links,
  onBack,
}: {
  section: PortfolioSection;
  /** The company whose work is showing — one entry of `section.projects`. */
  project: PortfolioProject;
  style?: PortfolioGalleryStyle;
  /** The other categories holding work for this company. Empty = untagged. */
  links?: GalleryLink[];
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
        // Falls back to the category name, so a project with photos but no
        // copy yet still shows a heading rather than an empty corner.
        title: (project.title ?? "").trim() || section.name,
        ...(project.subtitle ? { subtitle: project.subtitle } : {}),
        ...(project.description ? { description: project.description } : {}),
        // GalleryView pads/truncates to exactly four slots itself.
        photos: (project.images ?? []).slice(0, GALLERY_PHOTO_COUNT).map((url) => ({ url })),
      },
    ],
  };

  return (
    <div className="w-full h-full relative" style={{ overflow: "hidden" }}>
      <GalleryView content={content} pageIndex={0} topInset={textTopInset} links={links} />

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
