"use client";

import {
  DEFAULT_PORTFOLIO_CONTENT,
  type PortfolioContent,
  type PortfolioViewState,
} from "./content";
import { OverviewView } from "./views/overview-view";
import { SplitView } from "./views/split-view";
import { VerticalView } from "./views/vertical-view";

/**
 * Pure view switch for the portfolio pages:
 *   overview → split-panel (button1) or vertical (button2).
 * Transport-agnostic — the parent owns navigation (URL push in the CMS,
 * WS-synced state on live screens) and passes the current `view` back in.
 */
export function PortfolioApp({
  content,
  view,
  onNavigate,
}: {
  content?: PortfolioContent;
  view: PortfolioViewState;
  onNavigate: (view: PortfolioViewState) => void;
}) {
  const cards =
    content?.overview?.cards?.length
      ? content.overview.cards
      : DEFAULT_PORTFOLIO_CONTENT.overview.cards;

  // Out-of-range indices (stale WS state or URL after a content edit) fall back to overview.
  const card = view.cardIndex !== null ? cards[view.cardIndex] : undefined;

  if (view.cardIndex === null || !card) {
    return (
      <OverviewView
        content={content}
        onOpenSplit={(i) => onNavigate({ cardIndex: i, sectionIndex: null, splitView: true })}
        onOpenVertical={(i) => onNavigate({ cardIndex: i, sectionIndex: null })}
      />
    );
  }

  if (view.splitView) {
    return (
      <SplitView
        card={card}
        onBack={() => onNavigate({ cardIndex: null, sectionIndex: null })}
        onOpenSection={(si) => onNavigate({ cardIndex: view.cardIndex, sectionIndex: si, cameFromSplit: true })}
      />
    );
  }

  return (
    <VerticalView
      card={card}
      activeSectionIndex={view.sectionIndex ?? 0}
      onBack={() =>
        onNavigate(
          view.cameFromSplit
            ? { cardIndex: view.cardIndex, sectionIndex: null, splitView: true }
            : { cardIndex: null, sectionIndex: null }
        )
      }
    />
  );
}
