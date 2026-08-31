"use client";

import { useState } from "react";
import { CirclePlay } from "lucide-react";
import {
  DEFAULT_PORTFOLIO_CONTENT,
  DEFAULT_TITLE_FONT_SIZE,
  DEFAULT_DESCRIPTION_FONT_SIZE,
  DEFAULT_BUTTON_FONT_SIZE,
  DEFAULT_CARD_PADDING,
  type PortfolioContent,
} from "../content";
import { VideoPopup } from "../components/video-popup";
import { useReplayableWindowEvent } from "../../../lib/replayable-window-event";

/** Per-card neon accent, cycling purple/pink/cyan across the 3 columns. */
const ACCENTS = ["#e040fb", "#ec407a", "#26c6da"];

/**
 * Overview view — 3 columns, each: Title · 4:3 Image · a play icon + a Projects
 * pill. Authored in real 1920×1080 px (inside ScreenStage), dark neon-glow
 * palette (one accent color per card, cycling purple/pink/cyan).
 * Tapping the play icon opens the card's video in a popup (shown unconditionally
 * for now — a "only if a video is set" guard can be reintroduced once content
 * authoring catches up); tapping "Projects" opens the split-panel comparison
 * view (the parent app decides the transport — URL push in the CMS, WS-synced
 * state on live screens).
 */
export function OverviewView({
  content,
  onOpenSplit,
}: {
  content?: PortfolioContent;
  /** Called when the second button ("Projects") is tapped — opens the split-panel view for that card. */
  onOpenSplit?: (index: number) => void;
}) {
  // Fall back per-field to the matching default card, not just when the whole
  // array is missing — an experience with cards already saved but individual
  // fields left blank (title/description/image/buttons) should still show
  // sample content instead of empty space.
  const defaultCards = DEFAULT_PORTFOLIO_CONTENT.overview.cards;
  const rawCards = content?.overview?.cards?.length ? content.overview.cards : defaultCards;
  const cards = rawCards.map((card, i) => {
    const def = defaultCards[i];
    if (!def) return card;
    return {
      ...card,
      title: card.title?.trim() ? card.title : def.title,
      description: card.description?.trim() ? card.description : def.description,
      imageUrl: card.imageUrl || def.imageUrl,
      videoUrl: card.videoUrl || def.videoUrl,
      button1: card.button1?.trim() ? card.button1 : def.button1,
      button2: card.button2?.trim() ? card.button2 : def.button2,
    };
  });
  const ov = content?.overview;
  const titleFontSize = ov?.titleFontSize ?? DEFAULT_TITLE_FONT_SIZE;
  const descriptionFontSize = ov?.descriptionFontSize ?? DEFAULT_DESCRIPTION_FONT_SIZE;
  const buttonFontSize = ov?.buttonFontSize ?? DEFAULT_BUTTON_FONT_SIZE;
  const cardPadding = ov?.cardPadding ?? DEFAULT_CARD_PADDING;

  const [openVideo, setOpenVideo] = useState<string | null>(null);

  // Emit a `screen-control` window event so the player shell relays this video
  // change over WebSocket to every client of this screen (the physical TV
  // and any CMS mirror), keeping them in lockstep. Transport-agnostic: the UI
  // package never imports WS — the shell owns the relay.
  const emitScreenControl = (command: string, value: unknown) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("screen-control", { detail: { command, value } }));
  };

  // `emit: false` is used when APPLYING a remote command (the shell dispatched
  // it from an inbound SCREEN_COMMAND) — applying must not re-broadcast, or the
  // gateway's echo-to-sender would loop. Absolute values make any echo a no-op.
  const applyVideo = (url: string | null, opts?: { emit?: boolean }) => {
    setOpenVideo(url);
    if (opts?.emit) emitScreenControl("SET_PORTFOLIO_VIDEO", { videoUrl: url });
  };

  // Apply video changes pushed from other clients of this screen (relayed by
  // the shell as a `portfolio-set-video` window event). Apply without re-emitting.
  useReplayableWindowEvent<{ videoUrl?: string | null }>("portfolio-set-video", (detail) => {
    applyVideo(detail?.videoUrl ?? null, { emit: false });
  });

  const glassRestBackground = "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.06) 100%)";

  const glassButtonStyle = {
    background: glassRestBackground,
    border: "1px solid rgba(255,255,255,0.14)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#ffffff",
    borderRadius: 999,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: buttonFontSize,
    fontWeight: 300,
    letterSpacing: "0.02em",
  } as const;

  // Matches the Projects pill's height (paddingTop + paddingBottom + one text
  // line) so the two sit flush in the row regardless of buttonFontSize.
  const iconButtonSize = Math.round(buttonFontSize * 1.2) + 24;
  const glassIconButtonStyle = {
    background: glassRestBackground,
    border: "1px solid rgba(255,255,255,0.14)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#ffffff",
    borderRadius: "50%",
    width: iconButtonSize,
    height: iconButtonSize,
    flexShrink: 0,
  } as const;

  return (
    <div
      className="w-full h-full"
      style={{
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(135deg,#0a0e1a 0%,#0d1224 60%,#0f1628 100%)",
        padding: 144,
      }}
    >
      {/* Soft color blobs behind the cards — the flat page gradient alone has no
          texture for the cards' backdrop-blur to diffuse, which makes the frosted
          glass finish invisible. These give it something to blur. */}
      {ACCENTS.map((color, i) => (
        <div
          key={color}
          style={{
            position: "absolute",
            top: i === 1 ? "55%" : i === 0 ? "5%" : "20%",
            left: i === 0 ? "0%" : i === 1 ? "35%" : "70%",
            width: "45%",
            height: "60%",
            background: color,
            opacity: 0.35,
            filter: "blur(120px)",
            borderRadius: "50%",
          }}
        />
      ))}
      <div
        className="grid"
        style={{ position: "relative", zIndex: 1, gridTemplateColumns: "repeat(3, 1fr)", gap: 120, height: "100%" }}
      >
        {cards.map((card, i) => {
          return (
            <div
              key={i}
              className="flex flex-col"
              style={{
                position: "relative",
                height: "100%",
                background: "linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.07) 100%)",
                border: "1px solid rgba(255,255,255,0.18)",
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
                borderRadius: 28,
                padding: cardPadding,
                gap: cardPadding,
                minHeight: 0,
                overflow: "hidden",
                transition: "transform 0.25s ease",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = "translateY(-6px)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = "translateY(0)";
              }}
            >
              {/* Image stage — fills the remaining card height; fully blank (no
                  placeholder background) until an image is set */}
              <div
                style={{
                  position: "relative",
                  zIndex: 1,
                  flex: 1,
                  minHeight: 0,
                  width: "100%",
                  overflow: "hidden",
                }}
              >
                {card.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.imageUrl}
                    alt={card.title}
                    style={{ position: "relative", width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : null}
              </div>

              {/* Title + description grouped with their own tight gap, separate
                  from the wider cardPadding gap used between the other sections */}
              <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                <h2
                  style={{
                    color: "#ffffff",
                    fontSize: titleFontSize,
                    fontWeight: 300,
                    lineHeight: 1.1,
                    minHeight: 0,
                    margin: 0,
                  }}
                >
                  {card.title}
                </h2>

                {/* Description — height is fixed (3 lines' worth) on every card so
                    the image above ends up the same height and the gap down to the
                    buttons stays uniform, regardless of how much text any one
                    card's description has. */}
                <p
                  style={{
                    margin: 0,
                    height: Math.round(descriptionFontSize * 1.4 * 3),
                    color: "rgba(255,255,255,0.65)",
                    fontSize: descriptionFontSize,
                    fontWeight: 300,
                    lineHeight: 1.2,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {card.description}
                </p>
              </div>

              {/* Row: play-icon button (opens the video popup — shown
                  unconditionally for now; re-gate on card.videoUrl once content
                  authoring catches up) beside the Projects pill (opens the
                  split-panel comparison view, always available) */}
              <div
                className="flex items-center"
                style={{ position: "relative", zIndex: 1, gap: 12, width: "100%" }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={card.button1 || "Watch video"}
                  onClick={() => applyVideo(card.videoUrl ?? null, { emit: true })}
                  className="flex items-center justify-center cursor-pointer"
                  style={glassIconButtonStyle}
                >
                  <CirclePlay size={Math.round(iconButtonSize * 0.55)} strokeWidth={1.5} />
                </div>
                {card.button2 && card.button2.trim() ? (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenSplit?.(i)}
                    className="flex items-center justify-center cursor-pointer flex-1"
                    style={glassButtonStyle}
                  >
                    {card.button2}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {openVideo ? <VideoPopup src={openVideo} onClose={() => applyVideo(null, { emit: true })} /> : null}
    </div>
  );
}
