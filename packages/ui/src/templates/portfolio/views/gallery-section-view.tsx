"use client";

import { ChevronLeft } from "lucide-react";
import { GalleryView, PagerControl, type GalleryLink, type GalleryPager } from "../../gallery/gallery-view";
import type { GalleryContent } from "../../gallery/content";
import { FilmsPanel } from "../components/films-panel";
import {
  DEFAULT_PORTFOLIO_GALLERY_STYLE,
  GALLERY_PHOTO_COUNT,
  type PortfolioGalleryStyle,
  type PortfolioProject,
  type PortfolioSection,
} from "../content";

/**
 * A section whose type is "gallery" — what the split-view slider commits into
 * instead of a slideshow: one company's page, reached only by navigating there
 * (the overview → vertical → gallery drill-in, or a cross-category link from
 * another company page — see `links` below). Two layouts depending on
 * `section.galleryKind`:
 *  - "photos" (default): text beside the first four photos, tap to expand —
 *    the Gallery template's own layout, reused wholesale.
 *  - "videos": text above a video grid (`FilmsPanel`) — for a category like
 *    "Brand Films" where every company page is its films, not photos.
 *
 * Copy and photos/videos come from the `project`, which for a category
 * authored before companies existed is the section's own flat fields,
 * migrated by normalizeSections — so those pages look exactly as they did.
 */
/** Back button geometry, shared with the text clearance below. */
const BACK_TOP = 36;
const BACK_LEFT = 48;
const BACK_SIZE = 64;
/** Breathing room between the button and the title beneath it. */
const BACK_GAP = 20;

function BackButton({ onBack }: { onBack: () => void }) {
  return (
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
  );
}

export function GallerySectionView({
  section,
  project,
  style,
  links,
  pager,
  onBack,
}: {
  section: PortfolioSection;
  /** The company whose work is showing — one entry of `section.projects`. */
  project: PortfolioProject;
  style?: PortfolioGalleryStyle;
  /** The other categories holding work for this company. Empty = untagged. */
  links?: GalleryLink[];
  /** Steps to the other companies in this same category. */
  pager?: GalleryPager;
  onBack: () => void;
}) {
  const s = { ...DEFAULT_PORTFOLIO_GALLERY_STYLE, ...(style ?? {}) };

  // The button floats over the layout's top-left corner, which is exactly where
  // the title starts. Push the text down by however much the button overhangs
  // the layout's own top padding — derived rather than hardcoded, so changing
  // the outer margin in the editor can't reintroduce the overlap.
  const textTopInset = Math.max(0, BACK_TOP + BACK_SIZE + BACK_GAP - s.padding);

  if (section.galleryKind === "videos") {
    const title = (project.title ?? "").trim() || section.name;
    const showPager = (pager?.count ?? 0) > 1;
    const showLinks = (links?.length ?? 0) > 0;
    const linkSize = Math.round(s.descriptionFontSize * 0.8);

    return (
      <div
        className="w-full h-full relative flex flex-col"
        style={{
          overflow: "hidden",
          background: s.backgroundColor,
          color: s.textColor,
          fontFamily: "'Helvetica Neue', Arial, sans-serif",
          padding: s.padding,
          paddingTop: s.padding + textTopInset,
          gap: s.gap,
        }}
      >
        <div style={{ flexShrink: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: s.titleFontSize,
              fontWeight: 200,
              letterSpacing: "-0.025em",
              lineHeight: 1,
            }}
          >
            {title}
          </h1>
          {project.subtitle ? (
            <p
              style={{
                margin: `${s.gap * 0.6}px 0 0`,
                fontSize: s.subtitleFontSize,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
            >
              {project.subtitle}
            </p>
          ) : null}
          {project.description ? (
            <p
              style={{
                margin: `${s.gap * 0.6}px 0 0`,
                fontSize: s.descriptionFontSize,
                fontWeight: 400,
                lineHeight: 1.2,
                opacity: 0.9,
              }}
            >
              {project.description}
            </p>
          ) : null}
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <FilmsPanel videos={project.videos ?? []} />
        </div>

        {showPager || showLinks ? (
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: Math.round(s.gap * 0.5),
              alignItems: "center",
            }}
          >
            {showPager ? <PagerControl pager={pager!} size={linkSize} gap={Math.round(s.gap * 0.4)} /> : null}
            {showLinks ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: Math.round(s.gap * 0.4) }}>
                {links!.map((link, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={link.onSelect}
                    style={{
                      appearance: "none",
                      margin: 0,
                      padding: `${Math.round(linkSize * 0.6)}px ${Math.round(linkSize * 1.1)}px`,
                      borderRadius: 999,
                      border: "1px solid currentColor",
                      backgroundColor: "transparent",
                      color: "inherit",
                      fontFamily: "inherit",
                      fontSize: linkSize,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      lineHeight: 1,
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      opacity: 0.75,
                    }}
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <BackButton onBack={onBack} />
      </div>
    );
  }

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
      <GalleryView
        content={content}
        pageIndex={0}
        topInset={textTopInset}
        links={links}
        pager={pager}
      />
      <BackButton onBack={onBack} />
    </div>
  );
}
