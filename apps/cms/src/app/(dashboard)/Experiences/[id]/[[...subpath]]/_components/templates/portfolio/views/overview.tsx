import React from "react";
import type { Experience } from "@platform/db";
import {
  DEFAULT_PORTFOLIO_CONTENT,
  DEFAULT_TITLE_FONT_SIZE,
  DEFAULT_BUTTON_FONT_SIZE,
  DEFAULT_CARD_PADDING,
  type PortfolioContent,
} from "../content";

/**
 * Overview view — 3 columns, each: Title · 4:3 Image · two label buttons.
 * Authored in real 1920×1080 px (inside ScreenStage), fixed light palette.
 * Renders the saved content when present; falls back to the default placeholders.
 */
export function OverviewView({
  experience: _experience,
  content,
}: {
  experience: Experience;
  content?: PortfolioContent;
}) {
  const cards =
    content?.overview?.cards?.length
      ? content.overview.cards
      : DEFAULT_PORTFOLIO_CONTENT.overview.cards;
  const ov = content?.overview;
  const titleFontSize = ov?.titleFontSize ?? DEFAULT_TITLE_FONT_SIZE;
  const buttonFontSize = ov?.buttonFontSize ?? DEFAULT_BUTTON_FONT_SIZE;
  const cardPadding = ov?.cardPadding ?? DEFAULT_CARD_PADDING;

  return (
    <div className="w-full h-full" style={{ background: "#d4d4d4", padding: 48 }}>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 40, alignItems: "start" }}>
        {cards.map((card, i) => (
          <div
            key={i}
            className="flex flex-col"
            style={{ background: "#dcdcdc", borderRadius: 28, padding: cardPadding, gap: cardPadding, minHeight: 0 }}
          >
            <h2
              style={{
                color: "#1f1f1f",
                fontSize: titleFontSize,
                fontWeight: 400,
                lineHeight: 1.1,
                minHeight: 0,
              }}
            >
              {card.title}
            </h2>

            {/* Image — fixed 4:3, scales with the card */}
            <div
              style={{
                background: "#e8e8e8",
                borderRadius: 18,
                width: "100%",
                aspectRatio: "4 / 3",
                overflow: "hidden",
              }}
            >
              {card.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.imageUrl}
                  alt={card.title}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : null}
            </div>

            {/* Label buttons — only render the ones that have a label */}
            <div className="flex flex-col" style={{ gap: 12, width: "58%" }}>
              {[card.button1, card.button2]
                .filter((label) => label && label.trim())
                .map((label, b) => (
                  <div
                    key={b}
                    className="flex items-center justify-center"
                    style={{
                      background: "#4d4d4d",
                      color: "#f2f2f2",
                      borderRadius: 999,
                      paddingTop: 12,
                      paddingBottom: 12,
                      fontSize: buttonFontSize,
                      fontWeight: 400,
                    }}
                  >
                    {label}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
