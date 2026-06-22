import React from "react";
import Link from "next/link";
import type { Experience } from "@platform/db";
import { ScreenStage } from "@/components/screen-stage";
import { OverviewView } from "./views/overview";
import { readPortfolioContent, type PortfolioContent } from "./content";

interface PortfolioView {
  key: string;
  label: string;
  /** URL sub-path segment for this view ("" = base / Overview). */
  segment: string;
  View: React.ComponentType<{ experience: Experience; content?: PortfolioContent }>;
}

/** Predefined views (tabs). Adding a tab later = one entry here + its view file. */
const VIEWS: PortfolioView[] = [
  { key: "overview", label: "Overview", segment: "", View: OverviewView },
];

/**
 * Portfolio template — a routed multi-view shell. The active view is chosen from
 * the URL sub-path (`/experiences/<slug>/<segment>`); each view is a predefined
 * 1920×1080 layout rendered inside the ScreenStage.
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
  const seg = subpath[0] ?? "";
  const active = VIEWS.find((v) => v.segment === seg) ?? VIEWS[0]!;
  const ActiveView = active.View;
  const content = readPortfolioContent(experience.templateContent) ?? undefined;

  // Full-screen preview tab: just the active view, scaled to fit the whole window.
  if (mode === "preview") {
    return (
      <ScreenStage variant="fit-screen">
        <ActiveView experience={experience} content={content} />
      </ScreenStage>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-[10px] font-bold text-violet-500 tracking-[0.25em] uppercase">
          Portfolio
        </span>
        <nav className="flex items-center gap-1">
          {VIEWS.map((v) => {
            const href = `/experiences/${experience.slug}${v.segment ? `/${v.segment}` : ""}`;
            const isActive = v.key === active.key;
            return (
              <Link
                key={v.key}
                href={href}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  isActive
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "text-zinc-500 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {v.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <ScreenStage>
        <ActiveView experience={experience} content={content} />
      </ScreenStage>
    </div>
  );
}
