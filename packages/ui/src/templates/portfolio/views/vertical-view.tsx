"use client";

import { ChevronLeft } from "lucide-react";
import {
  normalizeSections,
  newPortfolioProject,
  type OverviewCard,
  type PortfolioGalleryStyle,
} from "../content";
import type { GalleryLink } from "../../gallery/gallery-view";
import { SlideshowPanel } from "../components/slideshow-panel";
import { GallerySectionView } from "./gallery-section-view";

/**
 * Vertical page — shown at `/<vertical-slug>[/<section-slug>]`: the active
 * section's content fills the whole screen; the back button and title float on
 * top under a gradient scrim. First section is active by default.
 * Authored in real 1920×1080 px (inside ScreenStage).
 *
 * "gallery" sections render their own full-bleed layout (text beside four
 * expandable photos) and bring their own back button, so they return early
 * rather than sit under the scrim — that header is built for a dark slideshow
 * and would be invisible over the gallery's light background.
 */
export function VerticalView({
  card,
  activeSectionIndex,
  activeProjectIndex = 0,
  galleryStyle,
  links,
  onOpenProject,
  focusProject,
  onBack,
}: {
  /** Films section only: open this company's film instead of the grid. */
  focusProject?: number;
  card: OverviewCard;
  activeSectionIndex: number;
  /** Which company's project a gallery section is showing. */
  activeProjectIndex?: number;
  /** Shared by every gallery section — see PortfolioContent.gallery. */
  galleryStyle?: PortfolioGalleryStyle;
  /** Cross-category jumps for the showing company, computed by PortfolioApp. */
  links?: GalleryLink[];
  /** Moves to another company in the SAME category, staying on this layout. */
  onOpenProject?: (projectIndex: number) => void;
  onBack: () => void;
}) {
  const sections = normalizeSections(card.sections);
  const active = Math.min(Math.max(activeSectionIndex, 0), sections.length - 1);
  const section = sections[active]!;

  if (section.type === "gallery" || section.type === "videos") {
    const projects = section.projects ?? [];

    // "videos" (e.g. Brand Films): one shared film grid of every company at
    // once — no per-company page, so no active project/pager/links.
    if (section.type === "videos") {
      return (
        <GallerySectionView
          section={section}
          projects={projects}
          style={galleryStyle}
          focusProject={focusProject}
          onBack={onBack}
        />
      );
    }

    // "gallery" (photos) — one company's page at a time.
    // An out-of-range index — a link followed after the target was deleted, or
    // WS state that outlived a content edit — falls back to the first project
    // rather than blanking the page, matching how `active` clamps above.
    const project = projects[activeProjectIndex] ?? projects[0] ?? newPortfolioProject();
    return (
      <GallerySectionView
        section={section}
        project={project}
        style={galleryStyle}
        links={links}
        pager={
          onOpenProject
            ? {
                // Clamped to what's really there, so the dots can't outlive a
                // company being deleted while the page is open.
                index: Math.min(activeProjectIndex, projects.length - 1),
                count: projects.length,
                onSelect: onOpenProject,
              }
            : undefined
        }
        onBack={onBack}
      />
    );
  }

  // Only "images" reaches here — "gallery" and "videos" both return above.
  return (
    <div className="w-full h-full relative" style={{ background: "#141414", overflow: "hidden" }}>
      {/* Full-screen content */}
      <div className="absolute inset-0">
        <SlideshowPanel images={section.images} frameless />
      </div>

      {/* Header overlay: back + title */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center gap-6"
        style={{
          padding: "36px 48px 72px",
          background: "linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0))",
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        <div className="flex items-center gap-4 min-w-0" style={{ pointerEvents: "auto" }}>
          <button
            onClick={onBack}
            className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
            style={{
              background: "rgba(0, 0, 0, 0.45)",
              color: "#f2f2f2",
              border: "none",
              borderRadius: 999,
              width: 64,
              height: 64,
            }}
            title="Go back"
          >
            <ChevronLeft size={36} />
          </button>
          <div className="flex flex-col gap-1 min-w-0">
            {/* Which split-view category (e.g. "Build"/"Technology") this
                slideshow is showing — stays pinned in the header regardless
                of which slide is active. */}
            <span
              style={{
                color: "rgba(255,255,255,0.7)",
                fontSize: 30,
                fontWeight: 100,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                textShadow: "0 2px 12px rgba(0,0,0,0.5)",
              }}
            >
              {section.name}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
