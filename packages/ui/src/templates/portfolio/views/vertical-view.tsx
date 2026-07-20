"use client";

import { ChevronLeft } from "lucide-react";
import { normalizeSections, type OverviewCard } from "../content";
import { SlideshowPanel } from "../components/slideshow-panel";
import { FilmsPanel } from "../components/films-panel";

/**
 * Vertical page — shown at `/<vertical-slug>[/<section-slug>]`: the active
 * section's content (image slideshow or videos grid) fills the whole screen;
 * the back button, title, and section filter pills float on top under a
 * gradient scrim. First section is active by default.
 * Authored in real 1920×1080 px (inside ScreenStage).
 */
export function VerticalView({
  card,
  activeSectionIndex,
  onBack,
  onSelectSection,
}: {
  card: OverviewCard;
  activeSectionIndex: number;
  onBack: () => void;
  onSelectSection: (sectionIndex: number) => void;
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

      {/* Header overlay: back + title left, section filter pills right */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between gap-6"
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

        <div className="flex items-center shrink-0" style={{ gap: 14, pointerEvents: "auto" }}>
          {sections.map((s, si) => (
            <button
              key={si}
              onClick={() => onSelectSection(si)}
              className="cursor-pointer transition-colors"
              style={{
                background: si === active ? "#ffffff" : "rgba(0, 0, 0, 0.35)",
                color: si === active ? "#1f1f1f" : "#ffffff",
                border: "2px solid rgba(255, 255, 255, 0.8)",
                borderRadius: 999,
                padding: "12px 36px",
                fontSize: 26,
                fontWeight: 400,
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
