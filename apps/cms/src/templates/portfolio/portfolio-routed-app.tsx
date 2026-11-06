"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  PortfolioApp,
  cardSlugs,
  sectionSlugs,
  projectSlugs,
  normalizeSections,
  DEFAULT_PORTFOLIO_CONTENT,
  SPLIT_VIEW_SEGMENT,
  type PortfolioContent,
  type PortfolioOrigin,
  type PortfolioViewState,
} from "@platform/ui/templates/portfolio";

/** `back` query value: "card.section.project" plus ".s" if that page came from the split view. */
function formatOrigin(o: PortfolioOrigin): string {
  return `${o.cardIndex}.${o.sectionIndex}.${o.projectIndex}${o.cameFromSplit ? ".s" : ""}`;
}

function parseOrigin(value: string | null): PortfolioOrigin | undefined {
  const m = value?.match(/^(\d+)\.(\d+)\.(\d+)(\.s)?$/);
  if (!m) return undefined;
  return {
    cardIndex: Number(m[1]),
    sectionIndex: Number(m[2]),
    projectIndex: Number(m[3]),
    cameFromSplit: m[4] ? true : undefined,
  };
}

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
    ? {
        ...view,
        cameFromSplit: searchParams.get("from") === "split",
        from: parseOrigin(searchParams.get("back")),
      }
    : localView;

  const navigate = (v: PortfolioViewState) => {
    if (!baseHref) {
      setLocalView(v);
      return;
    }
    let href = baseHref;
    // Built up before the query string is appended, so the company segment
    // can't land after `?from=split` and turn into part of the query.
    let query = "";
    if (v.cardIndex !== null) {
      const card = cards[v.cardIndex];
      if (card) {
        href += `/${cardSlugs(cards)[v.cardIndex]}`;
        if (v.splitView) {
          href += `/${SPLIT_VIEW_SEGMENT}`;
        } else if (v.sectionIndex !== null) {
          const sections = normalizeSections(card.sections);
          href += `/${sectionSlugs(sections)[v.sectionIndex]}`;
          // Project 0 is the default, so it stays out of the URL — the links
          // pre-dating companies keep the exact addresses they had.
          const projects = sections[v.sectionIndex]?.projects ?? [];
          if (v.projectIndex) {
            const slug = projectSlugs(projects)[v.projectIndex];
            if (slug) href += `/${slug}`;
          }
          const params = new URLSearchParams();
          if (v.cameFromSplit) params.set("from", "split");
          // The page a sideways jump started from, so Back can return to it.
          if (v.from) params.set("back", formatOrigin(v.from));
          const qs = params.toString();
          if (qs) query = `?${qs}`;
        }
      }
    }
    router.push(href + query);
  };

  return <PortfolioApp content={content} view={effectiveView} onNavigate={navigate} />;
}
