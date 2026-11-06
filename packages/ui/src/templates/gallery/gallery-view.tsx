"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  DEFAULT_GALLERY_CONTENT,
  normalizePages,
  clamp,
  EXPANDED_PCT_MIN,
  EXPANDED_PCT_MAX,
  DEFAULT_TITLE_FONT_SIZE,
  DEFAULT_SUBTITLE_FONT_SIZE,
  DEFAULT_DESCRIPTION_FONT_SIZE,
  DEFAULT_GAP,
  DEFAULT_PADDING,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_TEXT_COLOR,
  DEFAULT_EXPANDED_PCT,
  PHOTO_COUNT,
  type GalleryContent,
  type GalleryPhoto,
} from "./content";
import { useReplayableWindowEvent } from "../../lib/replayable-window-event";

/** Matches the commit/settle feel of the portfolio split view. */
const TRANSITION = "560ms cubic-bezier(0.22, 0.61, 0.36, 1)";
/** The rearrange is slightly quicker than the width slide so it lands first. */
const FAST = "420ms cubic-bezier(0.22, 0.61, 0.36, 1)";

/**
 * Type taken from the site's own heading and body setup rather than fixed px,
 * so the template matches it at whatever width it is rendered:
 *
 *   heading      text-3xl sm:text-2xl md:text-[32px] lg:text-[2.5rem]
 *                font-extralight tracking-tight scale-x-110 origin-left
 *                leading-none max-w-[90%]
 *   description  text-xs xl:text-sm leading-[1.2] opacity-90
 *
 * `cqi` is the text column's own inline size, so both scale with the column
 * instead of with a number someone typed. The figures are those rem sizes as a
 * share of that column at the authored 1920 layout, where it measures ~570px:
 * 40/570 ≈ 7%, 14/570 ≈ 2.45%. The clamp bounds are the reference's own — its
 * smallest step at one end, the size it settles on from lg up at the other.
 */
const TITLE_SIZE = "clamp(1.5rem, 7cqi, 2.5rem)";
const TITLE_WEIGHT = 200;
const TITLE_TRACKING = "-0.025em";
/** leading-none / leading-[1.2] — the line spacing has to match exactly. */
const TITLE_LEADING = 1;
const DESCRIPTION_LEADING = 1.2;
/** The description's half of the same rule, in JS — see useFitFontSize. */
const DESCRIPTION_CQI = 0.0245;
const DESCRIPTION_MIN_PX = 12; // text-xs
const DESCRIPTION_MAX_PX = 14; // text-sm

/** Measuring has to happen before the browser paints; on the server there is no
 *  layout to measure and useLayoutEffect would warn. */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The slots beside an expanded photo: every other photo, in its natural order. */
const railFor = (expandedIndex: number) =>
  Array.from({ length: PHOTO_COUNT }, (_, i) => i).filter((i) => i !== expandedIndex);

/**
 * Which photo is open, and how the rail is arranged — the whole of what a tap
 * on a photo changes, sent as one value so a swap can't land half-applied.
 */
interface GalleryExpansion {
  expanded: number | null;
  railOrder: number[];
}

/**
 * Relayed by the player shell to every client of a screen, so opening a photo
 * on a control tablet opens it on the wall as well. A plain string like the
 * portfolio's own SET_PORTFOLIO_VIEW / SET_PORTFOLIO_VIDEO — SCREEN_COMMAND
 * carries an open `command`, so the gateway needs no say in it.
 */
const EXPANSION_COMMAND = "SET_GALLERY_VIEW";
/** The window event the shell turns an inbound EXPANSION_COMMAND into. */
const EXPANSION_EVENT = "gallery-set-view";

/**
 * The Gallery template: a text block and four photos.
 *
 * Collapsed, it's a three-column grid — text top-left, the feature photo
 * spanning columns 2–3, three photos below.
 *
 * Tapping a photo expands it to `expandedPct` of the width. The remainder
 * becomes a narrow rail on the left holding the heading and the three photos
 * that weren't picked, stacked vertically. Tapping one of those three trades
 * places with the expanded one — it opens, and the photo it replaces drops into
 * the slot it just left. Tapping anywhere else in the rail restores the grid.
 * The description hides while a photo is open — at rail width there isn't room
 * for a paragraph, and the heading alone keeps the context.
 *
 * The two arrangements are separate layers that cross-fade while the rail's
 * width animates, because a CSS grid can't tween between different track
 * counts. The outgoing layer fades faster than the incoming one, so the eye
 * follows the photos sliding left rather than watching the grid squash.
 *
 * Renders ONE page of `content.pages`, chosen by `pageIndex`. Every page uses
 * this identical layout and the same shared style values. Which page is showing
 * is the parent's business (a URL segment in the CMS preview, a split-view
 * commit on a screen), matching how PortfolioApp leaves navigation to its
 * caller. Expansion, by contrast, is deliberately local state: a transient way
 * to look closer, so it shouldn't survive a reload or reach the URL.
 */
/** A jump to somewhere else this page's subject appears — see `links` below. */
export interface GalleryLink {
  label: string;
  onSelect: () => void;
}

/** Handle to the page's expanded-photo state — see `controlRef` below. */
export interface GalleryControl {
  isOpen: boolean;
  collapse: () => void;
}

/** Stepping through sibling pages in place — see `pager` below. */
export interface GalleryPager {
  index: number;
  count: number;
  onSelect: (index: number) => void;
}

export function GalleryView({
  content,
  pageIndex = 0,
  topInset = 0,
  links,
  pager,
  controlRef,
}: {
  /**
   * Lets a caller with its own back button ask "is a photo open?" and close it,
   * so Back from an expanded photo returns to the page with the description
   * instead of leaving the page. Assigned on every render; read it in a click
   * handler. Closing goes through the same path as a tap, so mirrored screens
   * follow.
   */
  controlRef?: React.MutableRefObject<GalleryControl | null>;
  content?: GalleryContent;
  pageIndex?: number;
  /**
   * Extra space above the text block, for a caller that floats chrome over the
   * top-left corner — the portfolio section view's back button sits there and
   * would otherwise land on the title.
   */
  topInset?: number;
  /**
   * Optional row of buttons under the text block. The portfolio fills this with
   * the other categories holding work for the same company, so a visitor can
   * cross to them without backing out to the overview and drilling in again.
   *
   * Optional, and nothing renders when it's empty — which is what keeps the
   * standalone Gallery template (no companies, no categories) exactly as it was.
   * What a link means is the caller's business, same as `pageIndex`.
   */
  links?: GalleryLink[];
  /**
   * Steps through sibling pages without leaving the layout — the portfolio
   * fills this with the other companies in the same category. One arrow at each
   * edge of the screen, wrapping at both ends; nothing renders for a count of
   * one, so a category with a single company looks untouched.
   */
  pager?: GalleryPager;
}) {
  const c = { ...DEFAULT_GALLERY_CONTENT, ...(content ?? {}) };
  const pages = normalizePages(c);
  // Out-of-range index (a stale URL after a page was deleted, or split-view
  // state that outlived a content edit) falls back to the first page.
  const page = pages[pageIndex] ?? pages[0]!;
  const photos = page.photos;
  const [expanded, setExpanded] = useState<number | null>(null);
  /**
   * Which photo sits in each rail slot. State rather than something derived
   * from `expanded`, for two reasons. Swapping has to put the outgoing photo in
   * the exact slot the incoming one vacated, which a filter of the original
   * order can't express — it would re-sort the rail under the finger. And the
   * slots stay mounted while the grid is showing, so their slide-in has a
   * previous position to animate from instead of appearing already in place.
   */
  const [railOrder, setRailOrder] = useState<number[]>(() => railFor(0));

  // Switching page while a photo is open would leave the expander showing the
  // previous page's picture. Resetting during render (rather than in an effect)
  // avoids painting that wrong frame at all.
  const [renderedPage, setRenderedPage] = useState(pageIndex);
  if (renderedPage !== pageIndex) {
    setRenderedPage(pageIndex);
    setExpanded(null);
    setRailOrder(railFor(0));
  }

  const gap = c.gap ?? DEFAULT_GAP;
  const padding = c.padding ?? DEFAULT_PADDING;
  const pct = clamp(c.expandedPct ?? DEFAULT_EXPANDED_PCT, EXPANDED_PCT_MIN, EXPANDED_PCT_MAX);
  const titleSize = c.titleFontSize ?? DEFAULT_TITLE_FONT_SIZE;
  const subtitleSize = c.subtitleFontSize ?? DEFAULT_SUBTITLE_FONT_SIZE;
  const descriptionSize = c.descriptionFontSize ?? DEFAULT_DESCRIPTION_FONT_SIZE;
  // Derived from the description rather than fixed, so the footer keeps its
  // place in the hierarchy when the editor's font-size controls are moved.
  const linkSize = Math.round(descriptionSize * 0.8);
  // A lone sibling is not worth a control, same test SlideshowPanel makes
  // before drawing its arrows.
  const showPager = (pager?.count ?? 0) > 1;
  const showLinks = (links?.length ?? 0) > 0;
  const isOpen = expanded !== null;

  // Swipe-to-page, same destination as the edge PagerArrow buttons below —
  // just a second way to reach them. Plain pointer tracking (no gesture
  // library elsewhere in this package) with a movement threshold, same shape
  // as screen-touchpad.tsx's drag-vs-tap handling. Only armed while there's
  // actually somewhere to swipe to, and not while a photo is expanded
  // (matches PagerArrow's own `hidden={isOpen}`) — no preventDefault, so a
  // plain tap on a photo/link still reaches its own onClick untouched.
  const swipeStartRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const SWIPE_THRESHOLD = 60;

  const handleSwipePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pager || pager.count <= 1 || isOpen) return;
    swipeStartRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  const handleSwipePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.id !== e.pointerId || !pager) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    pager.onSelect(dx < 0 ? (pager.index + 1) % pager.count : (pager.index - 1 + pager.count) % pager.count);
  };

  const handleSwipePointerCancel = () => {
    swipeStartRef.current = null;
  };
  const openPhoto = expanded !== null ? photos[expanded] : undefined;

  const arrowSize = Math.round(linkSize * 3.4);
  // How far in from each edge the arrows sit — a hair off it, so they read as
  // belonging to the screen rather than to the layout.
  const arrowOffset = Math.round(gap * 0.25);
  // ...and how much the grid gives up on each side to leave them that room.
  // Only when there are arrows: a lone company keeps the full width. The title
  // shrinks with it for free, being sized off the column rather than in px.
  const sideInset = showPager ? arrowOffset + arrowSize + Math.round(gap * 0.5) : 0;

  // The editor's px controls stay meaningful as a multiplier on the reference
  // size — nudging the type up or down — rather than as an absolute that
  // ignores how much room the column actually has.
  const titleScale = titleSize / DEFAULT_TITLE_FONT_SIZE;
  const descriptionScale = descriptionSize / DEFAULT_DESCRIPTION_FONT_SIZE;

  // Sized off the column, then shrunk further if the copy still doesn't fit the
  // room the heading leaves.
  const [descriptionRef, fittedDescriptionSize] = useFitFontSize(descriptionScale, [
    page.description,
    page.title,
    page.subtitle,
    descriptionSize,
    titleSize,
    subtitleSize,
    gap,
    padding,
    topInset,
    showPager,
    pager?.count,
    showLinks,
    links?.length,
  ]);

  /**
   * Every change to what's open goes through here, and every one a person made
   * is broadcast — a photo opened on a control tablet has to open on the wall
   * too, which local state alone could never do.
   *
   * `emit: false` is for APPLYING an inbound command: the gateway echoes to the
   * sender, so re-broadcasting what we just applied would loop. Absolute values
   * rather than deltas, so an echo that does arrive is a no-op. Same discipline
   * as PortfolioLiveApp and the overview's video popup.
   */
  const applyExpansion = (next: GalleryExpansion, opts?: { emit?: boolean }) => {
    setExpanded(next.expanded);
    setRailOrder(next.railOrder);
    if (opts?.emit && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("screen-control", {
          detail: { command: EXPANSION_COMMAND, value: next },
        })
      );
    }
  };

  useReplayableWindowEvent<Partial<GalleryExpansion>>(EXPANSION_EVENT, (detail) => {
    setExpanded(detail?.expanded ?? null);
    if (Array.isArray(detail?.railOrder)) setRailOrder(detail.railOrder);
  });

  /** Tap on a grid photo: open it, the rest fall into the rail in order. */
  const expand = (index: number) =>
    applyExpansion({ expanded: index, railOrder: railFor(index) }, { emit: true });

  /** Tap on a rail photo: it and the expanded one trade places. */
  const swap = (slot: number) => {
    const incoming = railOrder[slot];
    if (incoming === undefined || expanded === null) return;
    applyExpansion(
      { expanded: incoming, railOrder: railOrder.map((i, k) => (k === slot ? expanded : i)) },
      { emit: true }
    );
  };

  // Deliberately leaves `railOrder` alone: the rail fades out still holding the
  // three photos that were in it, instead of a fourth popping in mid-fade.
  const collapse = () => applyExpansion({ expanded: null, railOrder }, { emit: true });
  if (controlRef) controlRef.current = { isOpen, collapse };

  const heading = (railMode: boolean) => (
    <>
      <h1
        style={{
          // Optical left alignment: a glyph's built-in left gap grows with its
          // size, so the big title otherwise looks indented next to the smaller
          // subtitle and description. Em-based, so it tracks the font-size
          // controls. The rail keeps no pull-back (its text is much smaller).
          margin: railMode ? 0 : "0 0 0 -0.04em",
          // The rail is narrow — step the title down so it still fits on a
          // line or two instead of wrapping into a wall of text.
          fontSize: `calc(${TITLE_SIZE} * ${(railMode ? 0.62 : 1) * titleScale})`,
          fontWeight: TITLE_WEIGHT,
          letterSpacing: TITLE_TRACKING,
          lineHeight: TITLE_LEADING,
          // scale-x-110 origin-left, over max-w-[90%] — the widening is part of
          // the face, not a size, so it survives every step of the clamp.
          maxWidth: "90%",
          transform: "scaleX(1.1)",
          transformOrigin: "left",
          transition: `font-size ${FAST}`,
        }}
      >
        {page.title}
      </h1>
      {page.subtitle ? (
        <p
          style={{
            // Same `gap` as the description's margin below, so the space under
            // the title equals the space under the subtitle.
            margin: `${gap * (railMode ? 0.6 : 1)}px 0 0`,
            fontSize: railMode ? Math.round(subtitleSize * 0.85) : subtitleSize,
            // Same face as the title above it: weight, tracking and the 1.1x
            // widening — not bold. Spacing (margin above, line height) is
            // unchanged, so the description below sits where it did.
            fontWeight: TITLE_WEIGHT,
            letterSpacing: TITLE_TRACKING,
            lineHeight: 1.2,
            maxWidth: "90%",
            transform: "scaleX(1.1)",
            transformOrigin: "left",
            transition: `font-size ${FAST}, margin ${FAST}`,
          }}
        >
          {page.subtitle}
        </p>
      ) : null}
    </>
  );

  return (
    <div
      onPointerDown={handleSwipePointerDown}
      onPointerUp={handleSwipePointerUp}
      onPointerCancel={handleSwipePointerCancel}
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundColor: c.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
        color: c.textColor ?? DEFAULT_TEXT_COLOR,
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
      }}
    >
      {/* ─── Left side: full grid when closed, rail when open ─────────────── */}
      <div
        // Everything on this side that isn't one of the photos closes: the
        // heading, the gaps between rail slots, the bare background.
        onClick={isOpen ? collapse : undefined}
        style={{
          position: "absolute",
          inset: 0,
          // Fixed at full width, deliberately. This used to animate width from
          // 100% to (100-pct)% while the expanded photo animated 0% -> pct%,
          // so both siblings reflowed the whole row every frame for 560ms — on
          // a display screen, the most visible jank in the template.
          //
          // Nothing actually needed those intermediate widths: the two layers
          // below CROSS-FADE (the grid leaves fast precisely so it is never
          // seen squashing), so no one ever sees the grid at a width between
          // its open and closed states. Each layer is therefore pinned at the
          // one width it is visible at, and the photo panel slides in over the
          // top on a transform. Same motion, no layout.
          //
          // No padding here: both layers are absolutely positioned and inset
          // themselves by `padding`, since an abs child resolves against the
          // padding box and would otherwise ignore it.
          cursor: isOpen ? "pointer" : "default",
        }}
      >
        {/* Layer 1 — the collapsed grid. */}
        <div
          style={{
            position: "absolute",
            top: padding,
            bottom: padding,
            // Pulled in past the arrows rather than under them, so nothing has
            // to overlap. The rail below keeps the plain margin — the arrows
            // are gone by the time it shows.
            left: padding + sideInset,
            right: padding + sideInset,
            // Three equal columns: the feature photo spans columns 2–3, so its
            // left edge lands exactly on the middle photo's below it. That
            // shared vertical line is what makes the layout read as a grid.
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            // The links row is `auto` — it takes only the height it needs, and
            // the photos split whatever is left in the same 56/44 ratio as
            // before. No row at all for a company without other categories to
            // cross to, so those pages look exactly as they did.
            gridTemplateRows: showLinks ? "56fr 44fr auto" : "56fr 44fr",
            gap,
            opacity: isOpen ? 0 : 1,
            // Leaves quickly so the grid isn't seen squashing into the rail.
            transition: `opacity ${isOpen ? "180ms" : FAST} ease`,
            pointerEvents: isOpen ? "none" : "auto",
          }}
        >
          <div
            style={{
              gridColumn: "1 / 2",
              gridRow: "1 / 2",
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              overflow: "hidden",
              paddingTop: topInset,
              // What `cqi` in TITLE_SIZE resolves against: this column, not the
              // viewport. Safe here because the column's width comes from the
              // grid track, never from what's inside it.
              containerType: "inline-size",
            }}
          >
            {heading(false)}
            {page.description ? (
              <p
                ref={descriptionRef}
                style={{
                  margin: `${gap}px 0 0`,
                  fontSize: fittedDescriptionSize,
                  fontWeight: 400,
                  lineHeight: DESCRIPTION_LEADING,
                  opacity: 0.9,
                  // Takes the whole of the cell the heading doesn't want, which
                  // is what useFitFontSize measures against. Still clips, but
                  // only once the type has shrunk as far as it is allowed to.
                  flex: "1 1 0",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                {page.description}
              </p>
            ) : null}
          </div>

          {showLinks ? (
            <div
              style={{
                // Its own row at the foot of the layout, under the photos —
                // not trailing the paragraph — so it lands in the same place on
                // every page regardless of how much copy sits above it.
                gridColumn: "1 / 4",
                gridRow: "3 / 4",
                minWidth: 0,
                paddingTop: Math.round(gap * 0.5),
                display: "flex",
                justifyContent: "center",
                flexWrap: "wrap",
                gap: Math.round(gap * 0.4),
              }}
            >
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
                    // currentColor, not a fixed shade: the background and
                    // text colour are both editable, and anything
                    // hardcoded would disappear against one of the two.
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
                    // Secondary to the copy above it — same way the
                    // description sits at 0.9 under the title.
                    opacity: 0.75,
                  }}
                >
                  {link.label}
                </button>
              ))}
            </div>
          ) : null}

          <PhotoCell
            photo={photos[0]}
            index={0}
            disabled={isOpen}
            onSelect={() => expand(0)}
            style={{ gridColumn: "2 / 4", gridRow: "1 / 2", minWidth: 0, minHeight: 0 }}
          />
          {[1, 2, 3].map((i) => (
            <PhotoCell
              key={i}
              photo={photos[i]}
              index={i}
              disabled={isOpen}
              onSelect={() => expand(i)}
              style={{ gridColumn: `${i} / ${i + 1}`, gridRow: "2 / 3", minWidth: 0, minHeight: 0 }}
            />
          ))}
        </div>

        {/* Layer 2 — the rail: heading, then the three photos not picked. */}
        <div
          style={{
            position: "absolute",
            top: padding,
            bottom: padding,
            left: padding,
            // Pinned to the open layout's width instead of inheriting the
            // panel's (now constant) full width — this is the only place that
            // needed the old animated width, and it is invisible until open.
            right: `calc(${pct}% + ${padding}px)`,
            display: "flex",
            flexDirection: "column",
            gap,
            opacity: isOpen ? 1 : 0,
            // Arrives after the grid has gone, so they never overlap visibly.
            transition: `opacity ${FAST} ease ${isOpen ? "140ms" : "0ms"}`,
            // Live only while open, so the invisible slots can't intercept taps
            // meant for the grid underneath. A hit on the layer itself (rather
            // than on a slot) still bubbles to the close handler above.
            pointerEvents: isOpen ? "auto" : "none",
          }}
        >
          {/* Its own container, or `cqi` here would fall back to the viewport —
              the rail is a sibling of the grid, not a child of its text cell. */}
          <div
            style={{
              flexShrink: 0,
              overflow: "hidden",
              paddingTop: topInset,
              containerType: "inline-size",
            }}
          >
            {heading(true)}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap }}>
            {railOrder.map((i, slot) => (
              // Keyed by slot, not by photo: a swap then keeps the same element
              // and only changes its picture, so the exchange reads as the two
              // images trading places rather than as cells being reshuffled.
              <PhotoCell
                key={slot}
                photo={photos[i]}
                index={i}
                onSelect={() => swap(slot)}
                style={{
                  flex: "1 1 0",
                  minHeight: 0,
                  // Each slides in from the right, staggered, so the group
                  // reads as moving left into the rail rather than appearing.
                  transform: isOpen ? "translateX(0)" : "translateX(24%)",
                  transition: `transform ${TRANSITION} ${slot * 70}ms`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ─── Expanded photo ──────────────────────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          // Constant width; it slides in from off-frame rather than growing.
          // transform is compositor-only, so the 560ms reveal costs no layout
          // and no paint of the grid behind it.
          width: `${pct}%`,
          overflow: "hidden",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: `transform ${TRANSITION}`,
          willChange: "transform",
          backgroundColor: "#000",
        }}
      >
        {openPhoto?.url ? (
          <img
            src={openPhoto.url}
            alt={openPhoto.caption ?? ""}
            draggable={false}
            // contain, not cover: the whole picture must be visible here. cover
            // crops the edges, which is exactly what this view exists to avoid.
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        ) : null}
        {openPhoto?.caption ? (
          <p
            style={{
              position: "absolute",
              bottom: gap * 2,
              right: gap * 2,
              margin: 0,
              padding: `${gap / 2}px ${gap}px`,
              fontSize: subtitleSize,
              fontWeight: 700,
              color: "#fff",
              backgroundColor: "rgba(0,0,0,0.45)",
              borderRadius: 8,
            }}
          >
            {openPhoto.caption}
          </p>
        ) : null}
      </div>

      {/* ─── Stepping between sibling pages ──────────────────────────────── */}
      {showPager ? (
        <>
          <PagerArrow
            side="left"
            size={arrowSize}
            offset={arrowOffset}
            hidden={isOpen}
            onSelect={() => pager!.onSelect((pager!.index - 1 + pager!.count) % pager!.count)}
          />
          <PagerArrow
            side="right"
            size={arrowSize}
            offset={arrowOffset}
            hidden={isOpen}
            onSelect={() => pager!.onSelect((pager!.index + 1) % pager!.count)}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * One page-step arrow, pinned to an edge of the whole layout rather than sitting
 * in a control among the text. The two ends of the screen are the least
 * ambiguous place to put "back" and "forward" on a wall — nothing else lives
 * there, and neither one has to be found.
 *
 * Wrapping at both ends, matching SlideshowPanel, so a visitor can keep going in
 * one direction forever rather than hitting a dead end and having to reverse.
 */
function PagerArrow({
  side,
  size,
  offset,
  hidden,
  onSelect,
}: {
  side: "left" | "right";
  /** Diameter. The grid reserves this much room plus `offset` on each side. */
  size: number;
  /** Distance from its edge of the screen. */
  offset: number;
  /** True while a photo is expanded: it covers the layout these step through. */
  hidden: boolean;
  onSelect: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      // The left half of the layout closes an expanded photo on click. Even
      // faded out this button sits over it, so a stray tap must not do both.
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      aria-label={side === "left" ? "Previous" : "Next"}
      style={{
        position: "absolute",
        [side]: offset,
        top: "50%",
        transform: "translateY(-50%)",
        appearance: "none",
        margin: 0,
        padding: 0,
        width: size,
        height: size,
        borderRadius: 999,
        border: "1px solid currentColor",
        backgroundColor: "transparent",
        color: "inherit",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        opacity: hidden ? 0 : 0.75,
        // Leaves with the grid it steps through, and comes back with it.
        transition: `opacity ${FAST} ease`,
        pointerEvents: hidden ? "none" : "auto",
      }}
    >
      <Icon size={Math.round(size * 0.55)} />
    </button>
  );
}

/**
 * The largest font size at which the text still fits its box, never above `max`.
 *
 * The description's slot is whatever height the title and the subtitle leave
 * behind — it changes page to page — so one size either clips the copy or
 * strands empty space under it. CSS has no "fit this paragraph in that space",
 * so measure it.
 *
 * A binary search rather than scaling by the overflow ratio: line wrapping
 * makes height a staircase, not a line, so a proportional guess overshoots.
 * Roughly five reflows of one small paragraph, and only when the copy or the
 * type scale actually changes.
 *
 * The ceiling is the column-proportional size, not a typed-in one, so this only
 * ever takes type further down than the reference — never past it.
 */
function useFitFontSize(scale: number, deps: unknown[]) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [size, setSize] = useState(DESCRIPTION_MAX_PX);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // clamp(0.75rem, 2.45cqi, 0.875rem) worked out here rather than in CSS: the
    // search below has to own font-size to probe with, and a CSS rule and an
    // imperative override on the same property fight each other. Same formula,
    // same result, measured off the column the paragraph actually got.
    const max = Math.round(
      clamp(el.clientWidth * DESCRIPTION_CQI, DESCRIPTION_MIN_PX, DESCRIPTION_MAX_PX) * scale
    );
    // Below this it stops being readable across a room, and clipping is the
    // better failure — the same trade the reference makes by not going under
    // text-xs at all.
    const min = Math.max(9, Math.round(max * 0.6));
    const best = largestFitting(min, max, (px) => {
      el.style.fontSize = `${px}px`;
      // The box is flex-sized to the space left over, and clips; overflowing it
      // is exactly what "too big" means here.
      return el.scrollHeight <= el.clientHeight;
    });
    // Left applied rather than cleared, so nothing paints at the probe size
    // between here and the re-render that makes it React's value again.
    el.style.fontSize = `${best}px`;
    setSize(best);
    // Deliberately the content and type scale only, NOT `expanded`: opening a
    // photo animates this column's width over half a second, and a re-fit
    // during that would size the paragraph against a box it is only passing
    // through. The description is hidden while a photo is open anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [ref, size] as const;
}

/**
 * Biggest whole px in [min, max] for which `fits` holds, falling back to `min`
 * when nothing does. `fits` is assumed monotone — true up to some size, false
 * above it — which is what makes a measured probe cheap enough to run on a
 * paragraph. Separated from the DOM so the search itself can be checked.
 */
export function largestFitting(min: number, max: number, fits: (px: number) => boolean): number {
  let lo = min;
  let hi = max;
  let best = min;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Prev / dots / next for the sibling pages, sitting in the text column.
 *
 * Deliberately the Portfolio slideshow's vocabulary — chevrons either side,
 * dots between, the active one stretched into a pill, wrapping at both ends —
 * because stepping through companies in a category is the same act as stepping
 * through slides, and the two shouldn't need learning separately.
 *
 * What it does NOT borrow is that panel's dark floating chips: these sit inside
 * the text column beside the category links rather than over a photo, so they
 * take their colour from the text and stay legible whatever the editor sets the
 * background to.
 *
 * Not used internally by this file anymore (the standalone Gallery template's
 * own pager is the edge-pinned `PagerArrow` below) — kept exported for the
 * Portfolio video-grid gallery view, which sits outside this component and
 * still wants the in-column prev/dots/next treatment beside its links row.
 */
export function PagerControl({
  pager,
  size,
  gap,
}: {
  pager: GalleryPager;
  /** The link row's font size — everything here is scaled off it. */
  size: number;
  gap: number;
}) {
  const { index, count, onSelect } = pager;
  const step = (delta: number) => onSelect((index + delta + count) % count);

  const dot = Math.max(8, Math.round(size * 0.8));
  const activeDot = Math.round(dot * 3.1);
  const button = Math.round(size * 2.6);

  const arrow: React.CSSProperties = {
    appearance: "none",
    margin: 0,
    padding: 0,
    width: button,
    height: button,
    flexShrink: 0,
    borderRadius: 999,
    border: "1px solid currentColor",
    backgroundColor: "transparent",
    color: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    opacity: 0.75,
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap }}>
      <button type="button" onClick={() => step(-1)} style={arrow} aria-label="Previous">
        <ChevronLeft size={Math.round(button * 0.55)} />
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: Math.round(dot * 0.7) }}>
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            aria-label={`Page ${i + 1} of ${count}`}
            aria-current={i === index}
            style={{
              appearance: "none",
              margin: 0,
              padding: 0,
              border: "none",
              width: i === index ? activeDot : dot,
              height: dot,
              borderRadius: 999,
              backgroundColor: "currentColor",
              opacity: i === index ? 0.85 : 0.3,
              transition: "width 300ms ease, opacity 300ms ease",
              cursor: "pointer",
            }}
          />
        ))}
      </div>

      <button type="button" onClick={() => step(1)} style={arrow} aria-label="Next">
        <ChevronRight size={Math.round(button * 0.55)} />
      </button>
    </div>
  );
}

/**
 * One tappable photo — a cell of the collapsed grid, or a slot of the open
 * rail. Same element either way, so both react to a tap identically; only what
 * the tap means differs, which is the caller's `onSelect`.
 */
function PhotoCell({
  photo,
  index,
  disabled = false,
  onSelect,
  style,
}: {
  photo: GalleryPhoto | undefined;
  /** Position in the page's photos — used for the label and the empty state. */
  index: number;
  /** True for the grid's cells while a photo is open: the covered-up grid is
   *  then part of the "tap anywhere else to close" target, not a set of cells. */
  disabled?: boolean;
  onSelect: () => void;
  style?: React.CSSProperties;
}) {
  const url = photo?.url ?? "";
  return (
    <button
      type="button"
      // The rail's slots sit inside the region that closes on click, so a hit
      // on one must not also register as a hit on the background behind it.
      onClick={
        disabled
          ? undefined
          : (e) => {
              e.stopPropagation();
              onSelect();
            }
      }
      disabled={disabled}
      aria-label={photo?.caption || `Photo ${index + 1}`}
      style={{
        appearance: "none",
        border: "none",
        padding: 0,
        margin: 0,
        borderRadius: 4,
        overflow: "hidden",
        backgroundColor: url ? "#000" : "rgba(0,0,0,0.06)",
        cursor: disabled ? "pointer" : "zoom-in",
        ...style,
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          // Pointer-transparent so the button is always what a tap lands on,
          // never the picture inside it. An <img> is a target browsers like to
          // attach their own behaviour to — drag, long-press menu, hover
          // toolbars — any of which can take the tap and leave the photo simply
          // not opening. SlideshowPanel's slides are inert for the same reason.
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            pointerEvents: "none",
          }}
        />
      ) : (
        <span
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            opacity: 0.4,
          }}
        >
          Photo {index + 1}
        </span>
      )}
    </button>
  );
}
