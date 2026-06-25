"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PORTFOLIO_CONTENT,
  DEFAULT_TITLE_FONT_SIZE,
  DEFAULT_BUTTON_FONT_SIZE,
  DEFAULT_CARD_PADDING,
  type PortfolioContent,
} from "../content";
import { ProjectShowcaseView } from "./project-showcase";
import { VideoPopup } from "../components/video-popup";

/**
 * Overview view — 3 columns, each: Title · 4:3 Image · two label buttons.
 * Authored in real 1920×1080 px (inside ScreenStage), fixed light palette.
 * Tapping the first ("Watch Video") button opens the card's video in a popup.
 */
export function OverviewView({ 
  content,
  activeCardIndex: externalActiveCardIndex,
  onActiveCardChange,
}: { 
  content?: PortfolioContent;
  activeCardIndex?: number | null;
  onActiveCardChange?: (index: number | null) => void;
}) {
  const cards =
    content?.overview?.cards?.length
      ? content.overview.cards
      : DEFAULT_PORTFOLIO_CONTENT.overview.cards;
  const ov = content?.overview;
  const titleFontSize = ov?.titleFontSize ?? DEFAULT_TITLE_FONT_SIZE;
  const buttonFontSize = ov?.buttonFontSize ?? DEFAULT_BUTTON_FONT_SIZE;
  const cardPadding = ov?.cardPadding ?? DEFAULT_CARD_PADDING;

  const [openVideo, setOpenVideo] = useState<string | null>(null);
  const [localActiveCardIndex, setLocalActiveCardIndex] = useState<number | null>(null);

  const activeCardIndex = externalActiveCardIndex !== undefined ? externalActiveCardIndex : localActiveCardIndex;

  // Emit a `screen-control` window event so the player shell relays this view/
  // video change over WebSocket to every client of this screen (the physical TV
  // and any CMS mirror), keeping them in lockstep. Transport-agnostic: the UI
  // package never imports WS — the shell owns the relay.
  const emitScreenControl = (command: string, value: unknown) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("screen-control", { detail: { command, value } }));
  };

  // `emit: false` is used when APPLYING a remote command (the shell dispatched
  // it from an inbound SCREEN_COMMAND) — applying must not re-broadcast, or the
  // gateway's echo-to-sender would loop. Absolute values make any echo a no-op.
  const applyCardIndex = (i: number | null, opts?: { emit?: boolean }) => {
    setLocalActiveCardIndex(i);
    onActiveCardChange?.(i);
    if (opts?.emit) emitScreenControl("SET_PORTFOLIO_VIEW", { cardIndex: i });
  };

  const applyVideo = (url: string | null, opts?: { emit?: boolean }) => {
    setOpenVideo(url);
    if (opts?.emit) emitScreenControl("SET_PORTFOLIO_VIDEO", { videoUrl: url });
  };

  // Apply view/video changes pushed from other clients of this screen (relayed
  // by the shell as `portfolio-set-*` window events). Apply without re-emitting.
  useEffect(() => {
    const onSetView = (e: Event) => {
      const detail = (e as CustomEvent<{ cardIndex?: number | null }>).detail;
      applyCardIndex(detail?.cardIndex ?? null, { emit: false });
    };
    const onSetVideo = (e: Event) => {
      const detail = (e as CustomEvent<{ videoUrl?: string | null }>).detail;
      applyVideo(detail?.videoUrl ?? null, { emit: false });
    };
    window.addEventListener("portfolio-set-view", onSetView);
    window.addEventListener("portfolio-set-video", onSetVideo);
    return () => {
      window.removeEventListener("portfolio-set-view", onSetView);
      window.removeEventListener("portfolio-set-video", onSetVideo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buttonStyle = {
    background: "#4d4d4d",
    color: "#f2f2f2",
    borderRadius: 999,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: buttonFontSize,
    fontWeight: 400,
  } as const;

  if (activeCardIndex !== null) {
    return (
      <ProjectShowcaseView
        card={cards[activeCardIndex]!}
        onBack={() => applyCardIndex(null, { emit: true })}
      />
    );
  }

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
                  onClick={() => card.videoUrl && applyVideo(card.videoUrl, { emit: true })}
                  className="flex items-center justify-center"
                  style={{ ...buttonStyle, cursor: card.videoUrl ? "pointer" : "default" }}
                >
                  {card.button1}
                </div>
              ) : null}
              {!card.videoUrl && card.button2 && card.button2.trim() ? (
                <div 
                  role="button"
                  tabIndex={0}
                  onClick={() => applyCardIndex(i, { emit: true })}
                  className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity" 
                  style={buttonStyle}
                >
                  {card.button2}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {openVideo ? <VideoPopup src={openVideo} onClose={() => applyVideo(null, { emit: true })} /> : null}
    </div>
  );
}
