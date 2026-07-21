"use client";

import { ChevronLeft } from "lucide-react";
import { normalizeSections, type OverviewCard } from "../content";
import { SlideshowPanel } from "../components/slideshow-panel";
import { FilmsPanel } from "../components/films-panel";

/**
 * Vertical page — shown at `/<vertical-slug>[/<section-slug>]`: the active
 * section's content (image slideshow or videos grid) fills the whole screen;
 * the back button and title float on top under a gradient scrim. First
 * section is active by default.
 * Authored in real 1920×1080 px (inside ScreenStage).
 */
export function VerticalView({
  card,
  activeSectionIndex,
  onBack,
}: {
  card: OverviewCard;
  activeSectionIndex: number;
  onBack: () => void;
}) {
  const sections = normalizeSections(card.sections);
  const active = Math.min(Math.max(activeSectionIndex, 0), sections.length - 1);
  const section = sections[active]!;

  return (
    <div className="w-full h-full relative" style={{ background: "#141414", overflow: "hidden" }}>
      {/* Full-screen content */}
      <div className="absolute inset-0">
        {section.type === "videos" ? (
          <FilmsPanel videos={section.videos ?? []} frameless />
        ) : (
          <SlideshowPanel images={section.images} frameless />
        )}
      </div>

      {/* Header overlay: back + title */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center gap-6"
        style={{
          padding: "36px 48px 72px",
          background: "linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0))",
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        <div className="flex items-center gap-4 min-w-0" style={{ pointerEvents: "auto" }}>
          <button
            onClick={onBack}
            className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
            style={{
              background: "rgba(0, 0, 0, 0.45)",
              color: "#f2f2f2",
              border: "none",
              borderRadius: 999,
              width: 64,
              height: 64,
            }}
            title="Go back"
          >
            <ChevronLeft size={36} />
          </button>
          <h1
            style={{
              color: "#ffffff",
              fontSize: 46,
              fontWeight: 400,
              lineHeight: 1.1,
              textShadow: "0 2px 12px rgba(0,0,0,0.5)",
            }}
          >
            {card.title}
          </h1>
        </div>
      </div>
    </div>
  );
}
