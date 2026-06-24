"use client";

import { useRef, useState } from "react";
import {
  DEFAULT_PORTFOLIO_CONTENT,
  DEFAULT_TITLE_FONT_SIZE,
  DEFAULT_BUTTON_FONT_SIZE,
  DEFAULT_CARD_PADDING,
  type PortfolioContent,
} from "./content";

/**
 * Overview view — 3 columns, each: Title · 4:3 Image · two label buttons.
 * Authored in real 1920×1080 px (inside ScreenStage), fixed light palette.
 * Tapping the first ("Watch Video") button opens the card's video in a popup.
 */
export function OverviewView({ content }: { content?: PortfolioContent }) {
  const cards =
    content?.overview?.cards?.length
      ? content.overview.cards
      : DEFAULT_PORTFOLIO_CONTENT.overview.cards;
  const ov = content?.overview;
  const titleFontSize = ov?.titleFontSize ?? DEFAULT_TITLE_FONT_SIZE;
  const buttonFontSize = ov?.buttonFontSize ?? DEFAULT_BUTTON_FONT_SIZE;
  const cardPadding = ov?.cardPadding ?? DEFAULT_CARD_PADDING;

  const [openVideo, setOpenVideo] = useState<string | null>(null);

  const buttonStyle = {
    background: "#4d4d4d",
    color: "#f2f2f2",
    borderRadius: 999,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: buttonFontSize,
    fontWeight: 400,
  } as const;

  return (
    <div className="w-full h-full" style={{ background: "#d4d4d4", padding: 48 }}>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 40, alignItems: "start" }}>
        {cards.map((card, i) => (
          <div
            key={i}
            className="flex flex-col"
            style={{ background: "#dcdcdc", borderRadius: 28, padding: cardPadding, gap: cardPadding, minHeight: 0 }}
          >
            <h2 style={{ color: "#1f1f1f", fontSize: titleFontSize, fontWeight: 400, lineHeight: 1.1, minHeight: 0 }}>
              {card.title}
            </h2>

            {/* Image — fixed 4:3, scales with the card */}
            <div style={{ background: "#e8e8e8", borderRadius: 18, width: "100%", aspectRatio: "4 / 3", overflow: "hidden" }}>
              {card.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.imageUrl} alt={card.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : null}
            </div>

            {/* Label buttons — button 1 = Watch Video (opens popup), button 2 = label only */}
            <div className="flex flex-col" style={{ gap: 12, width: "58%" }}>
              {card.videoUrl && card.button1 && card.button1.trim() ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => card.videoUrl && setOpenVideo(card.videoUrl)}
                  className="flex items-center justify-center"
                  style={{ ...buttonStyle, cursor: card.videoUrl ? "pointer" : "default" }}
                >
                  {card.button1}
                </div>
              ) : null}
              {!card.videoUrl && card.button2 && card.button2.trim() ? (
                <div className="flex items-center justify-center" style={buttonStyle}>
                  {card.button2}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {openVideo ? <VideoPopup src={openVideo} onClose={() => setOpenVideo(null)} /> : null}
    </div>
  );
}

/** Full-stage video popup with Fullscreen + Close controls. */
function VideoPopup({ src, onClose }: { src: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const goFullscreen = () => {
    const el = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!el) return;
    if (el.requestFullscreen) void el.requestFullscreen().catch(() => {});
    else if (el.webkitEnterFullscreen) el.webkitEnterFullscreen();
  };

  const close = () => {
    if (typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    onClose();
  };

  return (
    <div
      onClick={close}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.88)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "78%", maxWidth: 1500 }}>
        {/* Controls */}
        <div style={{ position: "absolute", top: -64, right: 0, display: "flex", gap: 16 }}>
          <button
            onClick={goFullscreen}
            style={{
              background: "#ffffff",
              color: "#1f1f1f",
              border: "none",
              borderRadius: 999,
              padding: "12px 28px",
              fontSize: 24,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            ⛶ Fullscreen
          </button>
          <button
            onClick={close}
            aria-label="Close"
            style={{
              background: "rgba(255,255,255,0.16)",
              color: "#ffffff",
              border: "none",
              borderRadius: 999,
              width: 56,
              height: 56,
              fontSize: 28,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <video
          ref={videoRef}
          src={src}
          controls
          autoPlay
          playsInline
          style={{ width: "100%", height: "auto", maxHeight: "82vh", borderRadius: 18, background: "#000", display: "block" }}
        />
      </div>
    </div>
  );
}
