"use client";

import React, { useState } from "react";
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

/** Matches the commit/settle feel of the portfolio split view. */
const TRANSITION = "560ms cubic-bezier(0.22, 0.61, 0.36, 1)";
/** The rearrange is slightly quicker than the width slide so it lands first. */
const FAST = "420ms cubic-bezier(0.22, 0.61, 0.36, 1)";

/** The slots beside an expanded photo: every other photo, in its natural order. */
const railFor = (expandedIndex: number) =>
  Array.from({ length: PHOTO_COUNT }, (_, i) => i).filter((i) => i !== expandedIndex);

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

export function GalleryView({
  content,
  pageIndex = 0,
  topInset = 0,
  links,
}: {
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
  // Derived from the description rather than fixed, so the row keeps its place
  // in the hierarchy when the editor's font-size controls are moved.
  const linkSize = Math.round(descriptionSize * 0.8);
  const isOpen = expanded !== null;
  const openPhoto = expanded !== null ? photos[expanded] : undefined;

  /** Tap on a grid photo: open it, the rest fall into the rail in order. */
  const expand = (index: number) => {
    setExpanded(index);
    setRailOrder(railFor(index));
  };

  /** Tap on a rail photo: it and the expanded one trade places. */
  const swap = (slot: number) => {
    const incoming = railOrder[slot];
    if (incoming === undefined || expanded === null) return;
    setExpanded(incoming);
    setRailOrder(railOrder.map((i, k) => (k === slot ? expanded : i)));
  };

  // Deliberately leaves `railOrder` alone: the rail fades out still holding the
  // three photos that were in it, instead of a fourth popping in mid-fade.
  const collapse = () => setExpanded(null);

  const heading = (railMode: boolean) => (
    <>
      <h1
        style={{
          margin: 0,
          // The rail is narrow — step the title down so it still fits on a
          // line or two instead of wrapping into a wall of text.
          fontSize: railMode ? Math.round(titleSize * 0.62) : titleSize,
          fontWeight: 400,
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
          transition: `font-size ${FAST}`,
        }}
      >
        {page.title}
      </h1>
      {page.subtitle ? (
        <p
          style={{
            margin: `${gap * (railMode ? 0.6 : 1.6)}px 0 0`,
            fontSize: railMode ? Math.round(subtitleSize * 0.85) : subtitleSize,
            fontWeight: 700,
            lineHeight: 1.2,
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
          position: "relative",
          width: isOpen ? `${100 - pct}%` : "100%",
          height: "100%",
          flexShrink: 0,
          // No padding here: both layers are absolutely positioned and inset
          // themselves by `padding`, since an abs child resolves against the
          // padding box and would otherwise ignore it.
          transition: `width ${TRANSITION}`,
          cursor: isOpen ? "pointer" : "default",
        }}
      >
        {/* Layer 1 — the collapsed grid. */}
        <div
          style={{
            position: "absolute",
            inset: padding,
            // Three equal columns: the feature photo spans columns 2–3, so its
            // left edge lands exactly on the middle photo's below it. That
            // shared vertical line is what makes the layout read as a grid.
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gridTemplateRows: "56fr 44fr",
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
            }}
          >
            {heading(false)}
            {page.description ? (
              <p
                style={{
                  margin: `${gap}px 0 0`,
                  fontSize: descriptionSize,
                  fontWeight: 400,
                  lineHeight: 1.5,
                  opacity: 0.85,
                  // Allowed to shrink so a long paragraph clips itself rather
                  // than shoving the link row out of the bottom of the cell.
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                {page.description}
              </p>
            ) : null}

            {links && links.length > 0 ? (
              <div
                style={{
                  // Pinned to the foot of the cell rather than trailing the
                  // paragraph, so the row lands in the same place on every page
                  // regardless of how much copy sits above it.
                  marginTop: "auto",
                  paddingTop: gap,
                  flexShrink: 0,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: Math.round(gap * 0.4),
                }}
              >
                {links.map((link, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={link.onSelect}
                    style={{
                      appearance: "none",
                      margin: 0,
                      padding: `${Math.round(linkSize * 0.6)}px ${Math.round(linkSize * 1.1)}px`,
                      borderRadius: 999,
                      // currentColor, not a fixed shade: the background and text
                      // colour are both editable, and anything hardcoded here
                      // would disappear against one of the two.
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
                      // description sits at 0.85 under the title.
                      opacity: 0.75,
                    }}
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

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
            inset: padding,
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
          <div style={{ flexShrink: 0, overflow: "hidden", paddingTop: topInset }}>
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
          position: "relative",
          width: isOpen ? `${pct}%` : "0%",
          height: "100%",
          overflow: "hidden",
          flexShrink: 0,
          transition: `width ${TRANSITION}`,
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
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
