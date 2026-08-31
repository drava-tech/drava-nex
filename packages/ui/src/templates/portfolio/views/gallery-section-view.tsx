"use client";

import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { GalleryView, type GalleryLink, type GalleryPager } from "../../gallery/gallery-view";
import type { GalleryContent } from "../../gallery/content";
import { VideoPopup } from "../components/video-popup";
import {
  DEFAULT_PORTFOLIO_GALLERY_STYLE,
  GALLERY_FILM_LABEL,
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
 *
 * A project carrying a `videoUrl` also gets a "Film" button in the footer row,
 * playing it over the layout — the same popup and the same WS-synced open/close
 * the overview's "Watch Video" uses, so a film opened on one client opens on the
 * wall too.
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

  const [openVideo, setOpenVideo] = useState<string | null>(null);

  // Mirrors OverviewView's "Watch Video": emit a `screen-control` event that the
  // player shell relays over WebSocket to every client of this screen, so the
  // wall and any CMS mirror open and close the film together. `emit: false` is
  // for APPLYING an inbound command — re-broadcasting it would loop through the
  // gateway's echo-to-sender.
  const applyVideo = (url: string | null, opts?: { emit?: boolean }) => {
    setOpenVideo(url);
    if (opts?.emit && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("screen-control", {
          detail: { command: "SET_PORTFOLIO_VIDEO", value: { videoUrl: url } },
        })
      );
    }
  };

  useEffect(() => {
    const onSetVideo = (e: Event) => {
      const detail = (e as CustomEvent<{ videoUrl?: string | null }>).detail;
      setOpenVideo(detail?.videoUrl ?? null);
    };
    window.addEventListener("portfolio-set-video", onSetVideo);
    return () => window.removeEventListener("portfolio-set-video", onSetVideo);
  }, []);

  // Leaving the page must not leave a film playing behind it — switching company
  // or category swaps the project under this same mounted component.
  useEffect(() => {
    setOpenVideo(null);
  }, [project.videoUrl, section.name]);

  // First in the row: it plays THIS page, where the rest navigate away from it.
  // Absent entirely when no film is set — the presence of a video is the only
  // thing that puts the button on screen.
  const footerLinks: GalleryLink[] = [
    ...(project.videoUrl
      ? [{ label: GALLERY_FILM_LABEL, onSelect: () => applyVideo(project.videoUrl!, { emit: true }) }]
      : []),
    ...(links ?? []),
  ];

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
        links={footerLinks}
        pager={pager}
      />

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

      {/* Covers the whole layout — the wrapper above is the positioning context
          the popup's inset-0 resolves against. */}
      {openVideo ? (
        <VideoPopup src={openVideo} onClose={() => applyVideo(null, { emit: true })} />
      ) : null}
    </div>
  );
}
