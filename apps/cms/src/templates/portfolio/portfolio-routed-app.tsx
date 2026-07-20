"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PortfolioApp,
  cardSlugs,
  sectionSlugs,
  normalizeSections,
  DEFAULT_PORTFOLIO_CONTENT,
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
  const [localView, setLocalView] = useState<PortfolioViewState>(view);

  const cards =
    content?.overview?.cards?.length
      ? content.overview.cards
      : DEFAULT_PORTFOLIO_CONTENT.overview.cards;

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
        if (v.sectionIndex !== null) {
          href += `/${sectionSlugs(normalizeSections(card.sections))[v.sectionIndex]}`;
        }
      }
    }
    router.push(href);
  };

  return <PortfolioApp content={content} view={baseHref ? view : localView} onNavigate={navigate} />;
}
