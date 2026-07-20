import React from "react";
import Link from "next/link";
import type { Experience } from "@platform/db";
import {
  ScreenStage,
  readPortfolioContent,
  cardSlugs,
  sectionSlugs,
  normalizeSections,
  DEFAULT_PORTFOLIO_CONTENT,
  type PortfolioContent,
  type PortfolioViewState,
} from "@platform/ui/templates/portfolio";
import { PortfolioRoutedApp } from "./portfolio-routed-app";

/**
 * Resolves the URL sub-path to a portfolio view:
 *   []                                → overview
 *   [<vertical-slug>]                 → that vertical's page (2 section buttons)
 *   [<vertical-slug>, <section-slug>] → that section's slideshow
 * Unknown slugs degrade gracefully (bad vertical → overview, bad section →
 * vertical page) so stale links after a title rename don't 404.
 */
function resolveView(content: PortfolioContent, subpath: string[]): PortfolioViewState {
  const cards = content.overview.cards;
  const seg0 = subpath[0] ?? "";
  const cardIndex = seg0 ? cardSlugs(cards).indexOf(seg0) : -1;
  if (cardIndex < 0) return { cardIndex: null, sectionIndex: null };

  const seg1 = subpath[1] ?? "";
  const sections = normalizeSections(cards[cardIndex]?.sections);
  const sectionIndex = seg1 ? sectionSlugs(sections).indexOf(seg1) : -1;
  return { cardIndex, sectionIndex: sectionIndex >= 0 ? sectionIndex : null };
}

/**
 * Portfolio template — a routed multi-view shell. The active view is chosen from
 * the URL sub-path; each view is a predefined 1920×1080 layout rendered inside
 * the ScreenStage.
 */
export function PortfolioLayout({
  experience,
  subpath,
  mode = "edit",
}: {
  experience: Experience;
  subpath: string[];
  mode?: "edit" | "preview";
}) {
  const content = readPortfolioContent(experience.templateContent) ?? DEFAULT_PORTFOLIO_CONTENT;
  const view = resolveView(content, subpath);

  // Full-screen preview tab: URL-driven navigation through the [[...subpath]] catch-all.
  if (mode === "preview") {
    return (
      <ScreenStage variant="fit-screen">
        <PortfolioRoutedApp
          content={content}
          view={view}
          baseHref={`/preview/experiences/${experience.slug}`}
        />
      </ScreenStage>
    );
  }

  // Edit mode has no sub-path route — navigation stays local to the stage.
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-[10px] font-bold text-violet-500 tracking-[0.25em] uppercase">
          Portfolio
        </span>
        <nav className="flex items-center gap-1">
          <Link
            href={`/experiences/${experience.slug}`}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
          >
            Overview
          </Link>
        </nav>
      </div>

      <ScreenStage>
        <PortfolioRoutedApp content={content} view={view} baseHref={null} />
      </ScreenStage>
    </div>
  );
}
