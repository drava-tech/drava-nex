"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Film, LayoutGrid, Play } from "lucide-react";
import { GalleryView, type GalleryLink, type GalleryPager } from "../../gallery/gallery-view";
import type { GalleryContent } from "../../gallery/content";
import { useReplayableWindowEvent } from "../../../lib/replayable-window-event";
import { useInView } from "../../../lib/use-in-view";
import { FilmControlsOverlay } from "../components/film-controls-overlay";
import { useFilmPlayback } from "../components/use-film-playback";
import { usePortfolioScreen } from "../screen-context";
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

function BackButton({ onBack, label }: { onBack: () => void; label?: string }) {
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
        height: BACK_SIZE,
        ...(label ? { padding: "0 28px 0 18px", gap: 12 } : { width: BACK_SIZE }),
        fontSize: 22,
        fontWeight: 600,
      }}
      title="Go back"
    >
      <ChevronLeft size={36} />
      {label ? <span>{label}</span> : null}
    </button>
  );
}

/** One flattened video, in company order, for the full-screen player to page through. */
interface FlatFilm {
  url: string;
  company: string;
}

/**
 * One company tile in the Films grid. Its own component (not inline in the
 * `.map()`) so it can call `useInView` — the `<video>` thumbnail only mounts
 * once the tile actually scrolls near the viewport, instead of every
 * company's video fetching at once regardless of scroll position.
 */
function FilmTile({
  videos,
  label,
  style,
  onClick,
}: {
  videos: string[];
  label: string;
  style: Required<PortfolioGalleryStyle>;
  onClick?: () => void;
}) {
  const [ref, inView] = useInView<HTMLDivElement>("300px");
  const hasVideo = videos.length > 0;

  return (
    <div className="flex flex-col" style={{ gap: style.gap * 0.3 }}>
      <div
        ref={ref}
        role={hasVideo ? "button" : undefined}
        tabIndex={hasVideo ? 0 : undefined}
        onClick={onClick}
        className={hasVideo ? "relative cursor-pointer hover:opacity-80 transition-opacity" : "relative"}
        style={{
          background: hasVideo ? "#000" : "rgba(0,0,0,0.06)",
          borderRadius: 18,
          aspectRatio: "16 / 9",
          overflow: "hidden",
        }}
      >
        {hasVideo && inView ? (
          <video
            src={videos[0]}
            muted
            autoPlay
            loop
            playsInline
            preload="auto"
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
}

/**
 * The Films category body: defaults to a grid of every company (one tile
 * each); tapping a tile opens a full-screen inline player starting at that
 * company's first film, which then cycles through every company's videos
 * back-to-back (prev/next + autoplay-advance, remounting the `<video>` via
 * `key={current.url}` so each new source actually autoplays). A "View all"
 * toggle in the player returns to the grid. Deliberately not `FilmsPanel` (a
 * flat list of raw video URLs with no company grouping) — a tile here is a
 * company, not a video.
 */
function FilmsGridView({
  projects,
  style,
  textTopInset,
  onBack,
}: {
  projects: PortfolioProject[];
  style: Required<PortfolioGalleryStyle>;
  textTopInset: number;
  onBack: () => void;
}) {
  // Every company gets a grid tile, even with no films yet — a placeholder
  // tile so the category's roster of companies stays visible while content
  // is still being added, rather than the page looking empty.
  const companies = projects;

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

  const [mode, setMode] = useState<"player" | "grid">("grid");
  const [index, setIndex] = useState(0);

  // Audio must only ever leave the real panel, so a CMS mirror plays muted —
  // which is also what lets it autoplay at all. See PortfolioScreenProvider.
  const { mirror } = usePortfolioScreen();
  // The player box, so the transport bar's idle timer is fed by pointer
  // activity over the film rather than anywhere in the window.
  const playerRef = useRef<HTMLDivElement>(null);

  // Relays every navigation to every other client of this screen (the
  // physical TV and any CMS mirror) — same pattern as Gallery's
  // applyExpansion/Portfolio's navigate. `emit: false` is for APPLYING an
  // inbound command; the gateway echoes to the sender, so re-broadcasting
  // what was just applied would loop.
  const applyFilmView = (next: { mode: "player" | "grid"; index: number }, opts?: { emit?: boolean }) => {
    setMode(next.mode);
    setIndex(next.index);
    if (opts?.emit && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("screen-control", { detail: { command: "SET_FILM_VIEW", value: next } })
      );
    }
  };

  useReplayableWindowEvent<{ mode?: "player" | "grid"; index?: number }>("film-set-view", (detail) => {
    applyFilmView({ mode: detail?.mode ?? "grid", index: detail?.index ?? 0 });
  });

  const openFilm = (flatIndex: number) => {
    applyFilmView({ mode: "player", index: flatIndex }, { emit: true });
  };

  // Nothing to play yet — the grid (with its placeholder tiles) is the only
  // thing that makes sense to show.
  const showGrid = mode === "grid" || films.length === 0;
  const current = films[index];

  // Play/pause/seek for whichever film is up, synced to every other client of
  // this screen. Called unconditionally, as hooks must be — but `undefined`
  // while the grid is showing, because this surface really is playing nothing
  // then. `index` stays 0 behind the grid, so passing films[0] regardless would
  // claim to be playing the first film before anyone had opened it.
  const playback = useFilmPlayback(showGrid ? undefined : current?.url);

  // Prev/Next — pinned to the outer page's edges (like GalleryView's
  // PagerArrow) rather than sitting inside the video's own box, so the video
  // stays full-size instead of sharing a flex row with the buttons.
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

  // No swipe gesture here, deliberately. Paging films is the edge arrows' job
  // (and the transport bar's, which owns horizontal drags over the picture) —
  // a page-wide swipe listener competing with a scrub bar on the same axis is
  // exactly the ambiguity this page does not want.
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
      <div style={{ flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", gap: style.gap }}>
        {/* "View all" grid toggle — no heading text on this page anymore. */}
        {!showGrid ? (
          <button
            onClick={() => applyFilmView({ mode: "grid", index }, { emit: true })}
            style={{
              flexShrink: 0,
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
            }}
          >
            <LayoutGrid size={18} />
            View all
          </button>
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
                const label = company.company.trim() || company.title?.trim() || `Company ${i + 1}`;
                return (
                  <FilmTile
                    key={`${i}-${label}`}
                    videos={videos}
                    label={label}
                    style={style}
                    onClick={videos.length > 0 ? () => openFilm(startOffsets[i]!) : undefined}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div
          ref={playerRef}
          className="relative flex-1"
          style={{ minHeight: 0, borderRadius: 18, overflow: "hidden", background: "#000" }}
        >
          {/* No `controls`: the native bar is a few authored pixels tall once
              ScreenStage has scaled the stage, and nothing it does leaves this
              client. FilmControlsOverlay is the transport, and it drives the
              element through `playback`, which relays every action over the WS
              so the panel and the CMS mirror agree. */}
          <video
            key={current!.url}
            ref={playback.videoRef}
            src={current!.url}
            autoPlay
            playsInline
            muted={mirror}
            onEnded={() => applyFilmView({ mode: "player", index: (index + 1) % films.length }, { emit: true })}
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" }}
          />

          {/* Company name + position. Top-left of the player box (below the
              page's own back button, which is outside it) — it used to sit
              bottom-left, which is now where the transport bar's scrim is. */}
          <div
            style={{
              position: "absolute",
              top: 20,
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

          <FilmControlsOverlay playback={playback} surfaceRef={playerRef} />
        </div>
      )}

      {/* Prev/Next — pinned to the whole page's edges, outside the video's
          own box, so the video never shrinks to make room for them. */}
      {!showGrid && films.length > 1 ? (
        <>
          <button
            onClick={() =>
              applyFilmView({ mode: "player", index: (index - 1 + films.length) % films.length }, { emit: true })
            }
            style={{ ...edgeButtonStyle, left: 12 }}
            title="Previous"
          >
            <ChevronLeft size={30} />
          </button>
          <button
            onClick={() => applyFilmView({ mode: "player", index: (index + 1) % films.length }, { emit: true })}
            style={{ ...edgeButtonStyle, right: 12 }}
            title="Next"
          >
            <ChevronRight size={30} />
          </button>
        </>
      ) : null}

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
