"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { normalizeSections, type OverviewCard } from "../content";

/** Once the dragged divider pushes a panel past this share of the width, that
 * panel's "open slideshow" gesture commits — see `onMouseMove`. Also defines
 * how far the divider can be dragged (see the `clamped` calc below). */
const ADVANCE_THRESHOLD_PCT = 90;

/**
 * Split-panel view — full-screen left/right comparison layout.
 * A draggable vertical divider reveals/hides each side via `clip-path` — the
 * panels themselves stay full-stage size, so neither the cover image nor the
 * section-name label ever resizes, crops, or repositions while dragging; only
 * how much of each fixed panel is visible changes. Dragging a panel past 90%
 * of the width commits — it opens that panel's section as a full slideshow
 * page (`onOpenSection`) instead of the side-by-side compare.
 * Authored in real 1920×1080 px (inside ScreenStage).
 */
export function SplitView({
  card,
  onBack,
  onOpenSection,
}: {
  card: OverviewCard;
  onBack: () => void;
  /** Called with 0 (left section) or 1 (right section) when that panel's
   * "open slideshow" threshold is crossed. */
  onOpenSection?: (sectionIndex: number) => void;
}) {
  const sections = normalizeSections(card.sections);
  const left = sections[0]!;
  const right = sections[1]!;

  // Split position as a percentage of total width (0–100). Starts centred.
  const [splitPct, setSplitPct] = useState(50);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // A different vertical reuses this same mounted component — reset per-card state.
  useEffect(() => {
    setSplitPct(50);
  }, [card.title]);

  const onMouseDown = useCallback(() => {
    dragging.current = true;
  }, []);

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      // Clamp to the same bounds the commit thresholds use, so the divider
      // can be dragged all the way out to the threshold before it commits.
      const clamped = Math.min(Math.max(pct, 100 - ADVANCE_THRESHOLD_PCT), ADVANCE_THRESHOLD_PCT);

      // Dragging the divider left past the threshold means the right panel
      // now covers 90%+ of the width — open its section's slideshow.
      if (clamped <= 100 - ADVANCE_THRESHOLD_PCT) {
        dragging.current = false;
        onOpenSection?.(1);
        return;
      }
      // Symmetric case: dragging right past the threshold opens the left section's slideshow.
      if (clamped >= ADVANCE_THRESHOLD_PCT) {
        dragging.current = false;
        onOpenSection?.(0);
        return;
      }
      setSplitPct(clamped);
    },
    [onOpenSection]
  );

  const stopDrag = useCallback(() => {
    dragging.current = false;
  }, []);

  // Anchored per-side (not centered within the panel) so the label never
  // slides while dragging — it's fixed at its home quarter-position and is
  // simply covered/revealed as the divider crosses it, same as the image.
  const panelLabel: React.CSSProperties = {
    position: "absolute",
    bottom: 64,
    transform: "translateX(-50%)",
    color: "#ffffff",
    fontSize: 52,
    fontWeight: 300,
    letterSpacing: "0.04em",
    textShadow: "0 2px 24px rgba(0,0,0,0.8)",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    zIndex: 2,
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ background: "#0d1224", overflow: "hidden", userSelect: "none", cursor: dragging.current ? "col-resize" : "default" }}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      {/* ── Left panel — full-stage size always; clip-path reveals/hides it
          instead of resizing it, so the image and label inside never move ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: `inset(0 ${100 - splitPct}% 0 0)`,
          transition: dragging.current ? "none" : "clip-path 0.35s ease",
        }}
      >
        <Panel imageUrl={left.images[0]} />
        {/* Gradient scrim so label text reads over any image */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)",
            zIndex: 1,
          }}
        />
        <span style={{ ...panelLabel, left: "25%" }}>{left.name}</span>
      </div>

      {/* ── Right panel — same fixed/clipped approach, mirrored ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: `inset(0 0 0 ${splitPct}%)`,
          transition: dragging.current ? "none" : "clip-path 0.35s ease",
        }}
      >
        <Panel imageUrl={right.images[0]} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)",
            zIndex: 1,
          }}
        />
        <span style={{ ...panelLabel, left: "75%" }}>{right.name}</span>
      </div>

      {/* ── Draggable divider ── */}
      <div
        onMouseDown={onMouseDown}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${splitPct}%`,
          transform: "translateX(-50%)",
          width: 6,
          zIndex: 20,
          cursor: "col-resize",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* The visible bar */}
        <div
          style={{
            width: 4,
            height: "100%",
            background: "rgba(255,255,255,0.22)",
            boxShadow: "0 0 12px rgba(255,255,255,0.12)",
          }}
        />
        {/* Handle pill */}
        <div
          style={{
            position: "absolute",
            width: 36,
            height: 72,
            borderRadius: 999,
            background: "rgba(255,255,255,0.18)",
            border: "1.5px solid rgba(255,255,255,0.35)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
          }}
        >
          {/* Two-bar grip icon */}
          {[0, 1].map((k) => (
            <div key={k} style={{ width: 2, height: 28, borderRadius: 2, background: "rgba(255,255,255,0.6)" }} />
          ))}
        </div>
      </div>

      {/* ── Back button + card title ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          gap: 20,
          padding: "36px 48px",
          background: "linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0))",
          zIndex: 30,
          pointerEvents: "none",
        }}
      >
        <button
          onClick={onBack}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.45)",
            border: "none",
            borderRadius: 999,
            width: 64,
            height: 64,
            color: "#f2f2f2",
            cursor: "pointer",
          }}
          title="Go back"
        >
          <ChevronLeft size={36} />
        </button>
        <h1
          style={{
            margin: 0,
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
  );
}

/** Full-cover image panel — a single static cover image, dark placeholder when none is set. */
function Panel({ imageUrl }: { imageUrl?: string }) {
  return imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt=""
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
    />
  ) : (
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,#141c2e 0%,#0d1224 100%)" }} />
  );
}
