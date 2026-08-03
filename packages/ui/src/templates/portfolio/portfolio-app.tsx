"use client";

import {
  DEFAULT_PORTFOLIO_CONTENT,
  companyLinks,
  type PortfolioContent,
  type PortfolioViewState,
} from "./content";
import { OverviewView } from "./views/overview-view";
import { SplitView } from "./views/split-view";
import { VerticalView } from "./views/vertical-view";

/**
 * Pure view switch for the portfolio pages:
 *   overview → split-panel (button2, "Projects"); "Watch Video" (button1)
 *   opens a video popup locally without changing the view.
 * Transport-agnostic — the parent owns navigation (URL push in the CMS,
 * WS-synced state on live screens) and passes the current `view` back in.
 *
 * The cross-category company links are resolved here rather than deeper down
 * for the same reason: finding them needs every card, and following one is a
 * navigation, which is `onNavigate`'s job — so the views below receive a plain
 * list of labelled callbacks and stay unaware of how any of it works.
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

  const cardIndex = view.cardIndex;
  const sectionIndex = view.sectionIndex ?? 0;
  const projectIndex = view.projectIndex ?? 0;
  const links = companyLinks(cards, { cardIndex, sectionIndex, projectIndex }).map((link) => ({
    label: link.label,
    // Carries `cameFromSplit` across, so the back button still returns to
    // wherever this visit began however many sideways jumps it took.
    onSelect: () =>
      onNavigate({
        cardIndex: link.cardIndex,
        sectionIndex: link.sectionIndex,
        projectIndex: link.projectIndex,
        cameFromSplit: view.cameFromSplit,
      }),
  }));

  return (
    <VerticalView
      card={card}
      activeSectionIndex={sectionIndex}
      activeProjectIndex={projectIndex}
      galleryStyle={content?.gallery}
      links={links}
      // Same navigation as a cross-category link, only staying put — which is
      // why it goes through onNavigate too and lands in the URL and on any
      // mirrored screen, rather than being local state inside the layout.
      onOpenProject={(pi) =>
        onNavigate({
          cardIndex,
          sectionIndex,
          projectIndex: pi,
          cameFromSplit: view.cameFromSplit,
        })
      }
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
