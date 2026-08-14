"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Film, LayoutGrid, Play } from "lucide-react";
import { GalleryView, type GalleryLink, type GalleryPager } from "../../gallery/gallery-view";
import type { GalleryContent } from "../../gallery/content";
import {
  DEFAULT_PORTFOLIO_GALLERY_STYLE,
  GALLERY_PHOTO_COUNT,
  type PortfolioGalleryStyle,
  type PortfolioProject,
  type PortfolioSection,
} from "../content";

/**
 * A section whose type is "gallery" or "videos" — what the split-view slider
 * commits into instead of a slideshow. `VerticalView` picks the layout by
 * passing exactly one of `project` (gallery) or `projects` (videos):
 *  - "gallery": one company's page (text beside its first four photos, tap to
 *    expand), reached by navigating there — the overview → vertical →
 *    gallery drill-in, or a cross-category link from another company page
 *    (see `links`/`pager` below). The Gallery template's own layout, reused
 *    wholesale.
 *  - "videos": ALL companies at once, as one shared full-screen film player
 *    (with a "View all" grid toggle) — one tile per company (its first video
 *    as a thumbnail, its name as a label, a count badge when it has more
 *    than one), for a category like "Brand Films" where every company's
 *    films sit on the same page rather than a paged per-company page. No
 *    pager, no cross-category links — there's no single "active company"
 *    for either to be relative to.
 *
 * Copy and photos come from the `project` prop in the gallery path, which
 * for a category authored before companies existed is the section's own
 * flat fields, migrated by normalizeSections — so those pages look exactly
 * as they did.
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

/** One flattened video, in company order, for the full-screen player to page through. */
interface FlatFilm {
  url: string;
  company: string;
}

/**
 * The Films category body: defaults to a full-screen inline player cycling
 * through every company's videos back-to-back (prev/next + autoplay-advance),
 * with a "View all" toggle to switch to a grid of every company (one tile
 * each) for jumping straight to a specific company's film. Deliberately not
 * `FilmsPanel` (a flat list of raw video URLs with no company grouping) — a
 * tile here is a company, not a video.
 */
function FilmsGridView({
  section,
  projects,
  style,
  textTopInset,
  onBack,
}: {
  section: PortfolioSection;
  projects: PortfolioProject[];
  style: Required<PortfolioGalleryStyle>;
  textTopInset: number;
  onBack: () => void;
}) {
  // Every company gets a grid tile, even with no films yet — a placeholder
  // tile so the category's roster of companies stays visible while content
  // is still being added, rather than the page looking empty.
  const companies = projects;
  const title = (section.title ?? "").trim() || section.name;

  // Flattened in company order, with each film's starting offset recorded so
  // a grid tile click can jump the player straight to that company's first film.
  const { films, startOffsets } = useMemo(() => {
    const flat: FlatFilm[] = [];
    const offsets: number[] = [];
    for (const company of companies) {
      offsets.push(flat.length);
      const label = company.company.trim() || company.title?.trim() || "";
      for (const url of company.videos ?? []) flat.push({ url, company: label });
    }
    return { films: flat, startOffsets: offsets };
  }, [companies]);

  const [mode, setMode] = useState<"player" | "grid">("player");
  const [index, setIndex] = useState(0);

  const openFilm = (flatIndex: number) => {
    setIndex(flatIndex);
    setMode("player");
  };

  // Nothing to play yet — the grid (with its placeholder tiles) is the only
  // thing that makes sense to show.
  const showGrid = mode === "grid" || films.length === 0;
  const current = films[index];

  const edgeButtonStyle = {
    position: "absolute" as const,
    top: "50%",
    transform: "translateY(-50%)",
    background: "rgba(0,0,0,0.45)",
    color: "#f2f2f2",
    border: "none",
    borderRadius: 999,
    width: 56,
    height: 56,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    zIndex: 5,
  };

  return (
    <div
      className="w-full h-full relative flex flex-col"
      style={{
        overflow: "hidden",
        background: style.backgroundColor,
        color: style.textColor,
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
        padding: style.padding,
        paddingTop: style.padding + textTopInset,
        gap: style.gap,
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <h1
          style={{
            margin: 0,
            fontSize: style.titleFontSize,
            fontWeight: 200,
            letterSpacing: "-0.025em",
            lineHeight: 1,
          }}
        >
          {title}
        </h1>
        {section.subtitle ? (
          <p
            style={{
              margin: `${style.gap * 0.6}px 0 0`,
              fontSize: style.subtitleFontSize,
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            {section.subtitle}
          </p>
        ) : null}
        {section.description ? (
          <p
            style={{
              margin: `${style.gap * 0.6}px 0 0`,
              fontSize: style.descriptionFontSize,
              fontWeight: 400,
              lineHeight: 1.2,
              opacity: 0.9,
            }}
          >
            {section.description}
          </p>
        ) : null}
      </div>

      {showGrid ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {companies.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center">
              <p style={{ opacity: 0.5, fontSize: 32 }}>No companies yet</p>
            </div>
          ) : (
            <div
              className="grid content-start w-full"
              style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: style.gap }}
            >
              {companies.map((company, i) => {
                const videos = company.videos ?? [];
                const hasVideo = videos.length > 0;
                const label = company.company.trim() || company.title?.trim() || `Company ${i + 1}`;
                return (
                  <div key={`${i}-${label}`} className="flex flex-col" style={{ gap: style.gap * 0.3 }}>
                    <div
                      role={hasVideo ? "button" : undefined}
                      tabIndex={hasVideo ? 0 : undefined}
                      onClick={hasVideo ? () => openFilm(startOffsets[i]!) : undefined}
                      className={hasVideo ? "relative cursor-pointer hover:opacity-80 transition-opacity" : "relative"}
                      style={{
                        background: hasVideo ? "#000" : "rgba(0,0,0,0.06)",
                        borderRadius: 18,
                        aspectRatio: "16 / 9",
                        overflow: "hidden",
                      }}
                    >
                      {hasVideo ? (
                        <video
                          src={videos[0]}
                          muted
                          playsInline
                          preload="metadata"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : null}
                      {/* Play badge (real tile) / placeholder icon (no film yet) */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div
                          className="flex items-center justify-center"
                          style={{
                            background: hasVideo ? "rgba(0,0,0,0.55)" : "transparent",
                            color: hasVideo ? "#f2f2f2" : "currentColor",
                            opacity: hasVideo ? 1 : 0.35,
                            borderRadius: 999,
                            width: 72,
                            height: 72,
                          }}
                        >
                          {hasVideo ? (
                            <Play size={32} style={{ marginLeft: 4 }} fill="currentColor" />
                          ) : (
                            <Film size={32} />
                          )}
                        </div>
                      </div>
                      {/* Video-count badge */}
                      {videos.length > 1 ? (
                        <div
                          style={{
                            position: "absolute",
                            top: 12,
                            right: 12,
                            background: "rgba(0,0,0,0.65)",
                            color: "#fff",
                            borderRadius: 999,
                            padding: "4px 10px",
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          {videos.length} videos
                        </div>
                      ) : null}
                      {!hasVideo ? (
                        <div
                          style={{
                            position: "absolute",
                            bottom: 12,
                            left: 0,
                            right: 0,
                            textAlign: "center",
                            fontSize: 13,
                            fontWeight: 700,
                            opacity: 0.45,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          No video yet
                        </div>
                      ) : null}
                    </div>
                    {/* Company name label */}
                    <span
                      style={{
                        fontSize: Math.round(style.subtitleFontSize * 0.6),
                        fontWeight: 700,
                        opacity: hasVideo ? 0.85 : 0.5,
                      }}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="relative flex-1" style={{ minHeight: 0, borderRadius: 18, overflow: "hidden", background: "#000" }}>
          <video
            key={current!.url}
            src={current!.url}
            autoPlay
            controls
            playsInline
            onEnded={() => setIndex((i) => (i + 1) % films.length)}
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" }}
          />

          {films.length > 1 ? (
            <>
              <button
                onClick={() => setIndex((index - 1 + films.length) % films.length)}
                style={{ ...edgeButtonStyle, left: 20 }}
                title="Previous"
              >
                <ChevronLeft size={30} />
              </button>
              <button
                onClick={() => setIndex((index + 1) % films.length)}
                style={{ ...edgeButtonStyle, right: 20 }}
                title="Next"
              >
                <ChevronRight size={30} />
              </button>
            </>
          ) : null}

          {/* Company name + position, bottom-left */}
          <div
            style={{
              position: "absolute",
              bottom: 20,
              left: 20,
              background: "rgba(0,0,0,0.5)",
              color: "#f2f2f2",
              borderRadius: 999,
              padding: "8px 18px",
              fontSize: 15,
              fontWeight: 600,
              zIndex: 5,
            }}
          >
            {current!.company || "—"}
            {films.length > 1 ? ` · ${index + 1} / ${films.length}` : ""}
          </div>

          {/* "View all" grid toggle, top-right */}
          <button
            onClick={() => setMode("grid")}
            style={{
              position: "absolute",
              top: 20,
              right: 20,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(0,0,0,0.45)",
              color: "#f2f2f2",
              border: "none",
              borderRadius: 999,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              zIndex: 5,
            }}
          >
            <LayoutGrid size={18} />
            View all
          </button>
        </div>
      )}

      {!showGrid ? null : films.length > 0 && mode === "grid" ? (
        <button
          onClick={() => setMode("player")}
          style={{
            position: "absolute",
            top: BACK_TOP,
            right: BACK_LEFT,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(0,0,0,0.45)",
            color: "#f2f2f2",
            border: "none",
            borderRadius: 999,
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            zIndex: 10,
          }}
        >
          <Play size={16} style={{ marginLeft: 2 }} fill="currentColor" />
          Play
        </button>
      ) : null}

      <BackButton onBack={onBack} />
    </div>
  );
}

export function GallerySectionView({
  section,
  project,
  projects,
  style,
  links,
  pager,
  onBack,
}: {
  section: PortfolioSection;
  /** The company whose work is showing (photos-kind path) — one entry of `section.projects`. */
  project?: PortfolioProject;
  /** Every company in this category at once (videos-kind path). */
  projects?: PortfolioProject[];
  style?: PortfolioGalleryStyle;
  /** The other categories holding work for this company (photos-kind only). Empty = untagged. */
  links?: GalleryLink[];
  /** Steps to the other companies in this same category (photos-kind only). */
  pager?: GalleryPager;
  onBack: () => void;
}) {
  const s = { ...DEFAULT_PORTFOLIO_GALLERY_STYLE, ...(style ?? {}) };

  // The button floats over the layout's top-left corner, which is exactly where
  // the title starts. Push the text down by however much the button overhangs
  // the layout's own top padding — derived rather than hardcoded, so changing
  // the outer margin in the editor can't reintroduce the overlap.
  const textTopInset = Math.max(0, BACK_TOP + BACK_SIZE + BACK_GAP - s.padding);

  // The caller (VerticalView) picks the layout by which prop it passes —
  // `projects` for the videos-kind grid, `project` for the gallery-kind page.
  if (projects !== undefined) {
    return (
      <FilmsGridView
        section={section}
        projects={projects}
        style={s}
        textTopInset={textTopInset}
        onBack={onBack}
      />
    );
  }

  const activeProject = project!;
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
        title: (activeProject.title ?? "").trim() || section.name,
        ...(activeProject.subtitle ? { subtitle: activeProject.subtitle } : {}),
        ...(activeProject.description ? { description: activeProject.description } : {}),
        // GalleryView pads/truncates to exactly four slots itself.
        photos: (activeProject.images ?? []).slice(0, GALLERY_PHOTO_COUNT).map((url) => ({ url })),
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
