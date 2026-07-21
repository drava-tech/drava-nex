"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  PortfolioApp,
  cardSlugs,
  sectionSlugs,
  normalizeSections,
  DEFAULT_PORTFOLIO_CONTENT,
  SPLIT_VIEW_SEGMENT,
  type PortfolioContent,
  type PortfolioViewState,
} from "@platform/ui/templates/portfolio";

/**
 * URL-driven portfolio navigation for the CMS: each view state maps to a
 * sub-path under `baseHref` (`/<vertical-slug>[/<section-slug>]`) served by the
 * existing `[[...subpath]]` catch-all. With `baseHref` null (edit mode, which
 * has no sub-path route) navigation falls back to local state.
 */
export function PortfolioRoutedApp({
  content,
  view,
  baseHref,
}: {
  content?: PortfolioContent;
  view: PortfolioViewState;
  baseHref: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localView, setLocalView] = useState<PortfolioViewState>(view);

  const cards =
    content?.overview?.cards?.length
      ? content.overview.cards
      : DEFAULT_PORTFOLIO_CONTENT.overview.cards;

  // `cameFromSplit` has no home in the URL path — the vertical/section URL is
  // identical whether reached from the split view or the overview's "Explore"
  // button — so it's carried as a query param instead, read back here.
  const effectiveView: PortfolioViewState = baseHref
    ? { ...view, cameFromSplit: searchParams.get("from") === "split" }
    : localView;

  const navigate = (v: PortfolioViewState) => {
    if (!baseHref) {
      setLocalView(v);
      return;
    }
    let href = baseHref;
    if (v.cardIndex !== null) {
      const card = cards[v.cardIndex];
      if (card) {
        href += `/${cardSlugs(cards)[v.cardIndex]}`;
        if (v.splitView) {
          href += `/${SPLIT_VIEW_SEGMENT}`;
        } else if (v.sectionIndex !== null) {
          href += `/${sectionSlugs(normalizeSections(card.sections))[v.sectionIndex]}`;
          if (v.cameFromSplit) href += "?from=split";
        }
      }
    }
    router.push(href);
  };

  return <PortfolioApp content={content} view={effectiveView} onNavigate={navigate} />;
}
