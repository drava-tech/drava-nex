// Content shape for the Portfolio template (CMS-side). Stored on the experience as
// experience.templateContent.portfolio. Per-view so future views add their own slice.

export interface OverviewCard {
  title: string;
  imageUrl: string;
  button1: string;
  button2: string;
}

export interface PortfolioContent {
  overview: {
    cards: OverviewCard[];
    /** Style values (px) — one set shared by all 3 cards. */
    titleFontSize?: number;
    buttonFontSize?: number;
    // Card padding drives spacing throughout — outer padding AND the space
    // between title / image / buttons.
    cardPadding?: number;
  };
}

export const DEFAULT_TITLE_FONT_SIZE = 50;
export const DEFAULT_BUTTON_FONT_SIZE = 20;
export const DEFAULT_CARD_PADDING = 44;

export const DEFAULT_PORTFOLIO_CONTENT: PortfolioContent = {
  overview: {
    titleFontSize: DEFAULT_TITLE_FONT_SIZE,
    buttonFontSize: DEFAULT_BUTTON_FONT_SIZE,
    cardPadding: DEFAULT_CARD_PADDING,
    cards: [
      { title: "Experience Center", imageUrl: "", button1: "Watch Video", button2: "Projects" },
      { title: "Architecture & Interiors", imageUrl: "", button1: "Watch Video", button2: "Projects" },
      { title: "Brand Solutions", imageUrl: "", button1: "Watch Video", button2: "Projects" },
    ],
  },
};

/** Reads the portfolio content slice off an experience row, or null if unset. */
export function readPortfolioContent(
  templateContent: Record<string, unknown> | null | undefined
): PortfolioContent | null {
  const slice = templateContent?.["portfolio"];
  return slice ? (slice as PortfolioContent) : null;
}
