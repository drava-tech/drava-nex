"use client";

import {
  DEFAULT_PORTFOLIO_CONTENT,
  type PortfolioContent,
  type PortfolioViewState,
} from "./content";
import { OverviewView } from "./views/overview-view";
import { VerticalView } from "./views/vertical-view";

/**
 * Pure view switch for the portfolio pages: overview → vertical page (which
 * hosts the section filter tabs + slideshow/videos grid inline).
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
    return <OverviewView content={content} onOpenVertical={(i) => onNavigate({ cardIndex: i, sectionIndex: null })} />;
  }

  return (
    <VerticalView
      card={card}
      activeSectionIndex={view.sectionIndex ?? 0}
      onBack={() => onNavigate({ cardIndex: null, sectionIndex: null })}
      onSelectSection={(si) => onNavigate({ cardIndex: view.cardIndex, sectionIndex: si })}
    />
  );
}
