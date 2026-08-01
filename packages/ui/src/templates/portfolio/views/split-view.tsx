"use client";

import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeSections, sectionCoverImage, type OverviewCard } from "../content";

/** Once the divider pushes a panel past this share of the width, that panel's
 * "open slideshow" gesture commits. Also the resting bound of the drag — the
 * divider eases to exactly here before the section opens. */
const ADVANCE_THRESHOLD_PCT = 95;
const MIN_PCT = 100 - ADVANCE_THRESHOLD_PCT;

/** Duration of a full centre→edge advance. Shorter trips scale down from this
 * (see `tweenTo`) so a commit from an already-dragged-out divider snaps rather
 * than crawling the last few percent. */
const ADVANCE_ANIM_MS = 840;

/** Travel, in percentage points, that `ADVANCE_ANIM_MS` is quoted for — the
 * centre-to-threshold distance. */
const REFERENCE_TRAVEL_PCT = ADVANCE_THRESHOLD_PCT - 50;

/** Floor so very short commits still read as motion rather than a jump cut. */
const MIN_ANIM_MS = 290;

/** Per-frame share of the remaining pointer distance the divider closes while
 * dragging, quoted at 60fps and rescaled for the real frame time below. This
 * is what gives the bar its weight: it chases the pointer instead of being
 * welded to it, which is the single biggest difference between this and a
 * plain input[type=range]. Higher = tighter//snappier, lower = heavier. */
const DRAG_FOLLOW = 0.2;

/** Pointer travel (px) past which a press is a drag, not a click. Keeps a
 * sloppy tap on a panel from being read as a swipe, and vice versa. */
const CLICK_SLOP_PX = 6;

/** How near a commit bound the divider gets before it starts fading out, in
 * percentage points. The line is gone by the time it reaches the bound, so a
 * commit ends on an empty stage rather than cutting away with the bar still
 * sitting there. */
const FADE_ZONE_PCT = 16;

/** Opacity below which the divider counts as gone, and the section is allowed
 * to open. Tied to the fade rather than to the end of the tween: the easing
 * spends its final fifth crawling the last couple of percent, long after the
 * line stopped being visible, and waiting that out was dead time on screen. */
const HIDDEN_EPSILON = 0.05;

/** Matches the old cubic-bezier(0.22, 1, 0.36, 1): fast off the mark, long
 * settle. Right for a commit that continues an in-flight drag — the divider is
 * already moving, so it should only ever decelerate. */
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

/** Symmetric ease for a commit that starts from a standstill (a click). An
 * ease-out launches at full speed from rest, which reads as a snap; this ramps
 * in and out, which is what makes the travel look poured rather than fired. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Smoothstep — gentle at both ends, no visible kink where the fade begins. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Divider opacity for a given split position: 1 through the middle of the
 * stage, easing to 0 exactly as it arrives at either commit bound. */
function fadeFor(pct: number): number {
  const toNearestBound = Math.min(pct - MIN_PCT, ADVANCE_THRESHOLD_PCT - pct);
  return smoothstep(Math.max(0, Math.min(1, toNearestBound / FADE_ZONE_PCT)));
}

type Tween = {
  from: number;
  to: number;
  start: number;
  duration: number;
  easing: (t: number) => number;
  onDone?: () => void;
  /** Guards against `onDone` running twice — once on the vanish, once at the
   * end of the tween. */
  fired?: boolean;
};

/**
 * Split-panel view — full-screen left/right comparison layout.
 * A draggable vertical divider reveals/hides each side via `clip-path` — the
 * panels themselves stay full-stage size, so neither the cover image nor the
 * section-name label ever resizes, crops, or repositions while dragging; only
 * how much of each fixed panel is visible changes. Pushing a panel past
 * `ADVANCE_THRESHOLD_PCT` commits: the divider eases the rest of the way out
 * and that panel's section opens as a full slideshow page (`onOpenSection`).
 * Clicking a panel does the same thing without the drag.
 *
 * Position lives in a `--split` CSS custom property written straight to the
 * DOM from a rAF loop, not in React state — dragging therefore causes zero
 * re-renders, and the same loop serves both the pointer-follow and the
 * commit/settle tweens so they can never fight each other.
 * Authored in real 1920×1080 px (inside ScreenStage).
 */
export function SplitView({
  card,
  onBack,
  onOpenSection,
}: {
  card: OverviewCard;
  onBack: () => void;
  /** Called with 0 (left section) or 1 (right section) once that panel's
   * commit animation has finished playing. */
  onOpenSection?: (sectionIndex: number) => void;
}) {
  const sections = normalizeSections(card.sections);
  const left = sections[0]!;
  const right = sections[1]!;

  const containerRef = useRef<HTMLDivElement>(null);

  /** Where the divider actually is, 0–100. The rendered truth. */
  const current = useRef(50);
  /** Where the pointer is asking it to be. `current` chases this. */
  const target = useRef(50);
  const tween = useRef<Tween | null>(null);
  const dragging = useRef(false);
  const committed = useRef(false);
  const raf = useRef<number | null>(null);
  const lastFrame = useRef(0);
  /** Pointer-down point, for the drag-vs-click test in `advanceTo`. */
  const downPt = useRef({ x: 0, y: 0 });

  // Only the two things that genuinely change appearance are state. Both flip
  // at most twice per gesture, so they cost nothing.
  const [active, setActive] = useState(false);
  const [hovering, setHovering] = useState(false);
  // Mirrors `committed` as state — the cursor styling below is read during
  // render, where a ref's value isn't reliable.
  const [committing, setCommitting] = useState(false);

  /** Two style writes per frame, no React involved. Position and fade are
   * derived from the same number so they can never drift apart. */
  const paint = useCallback((pct: number) => {
    const el = containerRef.current;
    if (!el) return;
    el.style.setProperty("--split", `${pct}%`);
    el.style.setProperty("--divider-fade", `${fadeFor(pct)}`);
  }, []);

  const frame = useCallback(
    (now: number) => {
      const dt = Math.min(now - lastFrame.current, 64); // clamp tab-switch spikes
      lastFrame.current = now;

      const t = tween.current;
      if (t) {
        const p = t.duration <= 0 ? 1 : Math.min(1, (now - t.start) / t.duration);
        current.current = t.from + (t.to - t.from) * t.easing(p);
        paint(current.current);

        // Open the moment the line is actually invisible, not when the tween
        // technically completes — those are ~200ms apart on a full advance.
        if (!t.fired && t.onDone && fadeFor(current.current) <= HIDDEN_EPSILON) {
          t.fired = true;
          t.onDone();
        }

        if (p >= 1) {
          tween.current = null;
          raf.current = null;
          // Only reachable for tweens that never cross the fade zone.
          if (!t.fired) t.onDone?.();
          return;
        }
      } else if (dragging.current) {
        // Frame-rate independent exponential follow: the same visual weight at
        // 60Hz and 144Hz, rather than a divider that feels twice as tight on a
        // high-refresh screen.
        const alpha = 1 - Math.pow(1 - DRAG_FOLLOW, dt / (1000 / 60));
        current.current += (target.current - current.current) * alpha;
        // Snap out the last sliver so we don't burn frames asymptoting.
        if (Math.abs(target.current - current.current) < 0.01) current.current = target.current;
        paint(current.current);
      } else {
        raf.current = null; // idle — stop the loop entirely
        return;
      }

      raf.current = requestAnimationFrame(frame);
    },
    [paint]
  );

  const ensureLoop = useCallback(() => {
    if (raf.current != null) return;
    lastFrame.current = performance.now();
    raf.current = requestAnimationFrame(frame);
  }, [frame]);

  const tweenTo = useCallback(
    (to: number, easing: (t: number) => number, onDone?: () => void) => {
      const from = current.current;
      const travel = Math.abs(to - from);
      tween.current = {
        from,
        to,
        start: performance.now(),
        // Scale duration with distance so speed stays roughly constant.
        duration: Math.max(MIN_ANIM_MS, ADVANCE_ANIM_MS * (travel / REFERENCE_TRAVEL_PCT)),
        easing,
        onDone,
      };
      ensureLoop();
    },
    [ensureLoop]
  );

  /**
   * Commit to a section. Unlike the old behaviour — which cut to the new page
   * the instant the pointer crossed the threshold, mid-motion — this always
   * plays the divider out until it has faded from view, and opens on that
   * frame — so the panel is still visibly filling the stage as the section
   * arrives. Reaching the threshold by drag and by click look identical.
   */
  const commit = useCallback(
    (sectionIndex: 0 | 1, fromRest: boolean) => {
      if (committed.current) return;
      committed.current = true;
      dragging.current = false;
      setActive(false);
      setCommitting(true);
      tweenTo(
        sectionIndex === 0 ? ADVANCE_THRESHOLD_PCT : MIN_PCT,
        // A click starts from a standstill and needs to ramp up; a drag-commit
        // is already at speed and should only slow down.
        fromRest ? easeInOutCubic : easeOutQuint,
        () => onOpenSection?.(sectionIndex)
      );
    },
    [tweenTo, onOpenSection]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (committed.current) return;
      tween.current = null; // grabbing mid-settle takes over cleanly
      dragging.current = true;
      target.current = current.current;
      setActive(true);
      // Capture means the drag survives leaving the divider, the container, or
      // the window — the old onMouseLeave teardown dropped it on all three.
      e.currentTarget.setPointerCapture(e.pointerId);
      ensureLoop();
    },
    [ensureLoop]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;

      // Threshold is tested against the raw pointer, not the smoothed
      // position, so the commit fires the moment you *ask* for it.
      if (pct >= ADVANCE_THRESHOLD_PCT) return commit(0, false);
      if (pct <= MIN_PCT) return commit(1, false);

      target.current = pct;
    },
    [commit]
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // The loop keeps running until `current` finishes coasting into `target`.
  }, []);

  /** Click-to-advance. Clicking the *left* panel sends the divider *right*,
   * because it's the opposite panel that gets squeezed away. */
  const advanceTo = useCallback(
    (sectionIndex: 0 | 1, e: React.MouseEvent) => {
      // Suppress the click browsers synthesise at the end of a drag.
      const slop = Math.hypot(e.clientX - downPt.current.x, e.clientY - downPt.current.y);
      if (slop > CLICK_SLOP_PX || dragging.current || committed.current) return;
      commit(sectionIndex, true);
    },
    [commit]
  );

  // A different vertical reuses this same mounted component — reset per-card.
  useEffect(() => {
    current.current = 50;
    target.current = 50;
    tween.current = null;
    dragging.current = false;
    committed.current = false;
    setActive(false);
    setCommitting(false);
    paint(50);
  }, [card.title, paint]);

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    },
    []
  );

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

  const panelBase: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    // Promote to its own layer so per-frame clip-path changes don't repaint
    // the full-bleed cover image underneath them.
    willChange: "clip-path",
    cursor: committing ? "default" : "pointer",
  };

  const raised = active || hovering;

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={
        {
          "--split": "50%",
          "--divider-fade": "1",
          background: "#0d1224",
          overflow: "hidden",
          userSelect: "none",
          touchAction: "none",
          cursor: active ? "col-resize" : "default",
        } as React.CSSProperties
      }
      onPointerDown={(e) => {
        downPt.current = { x: e.clientX, y: e.clientY };
      }}
    >
      {/* ── Left panel — full-stage size always; clip-path reveals/hides it
          instead of resizing it, so the image and label inside never move ── */}
      <div
        onClick={(e) => advanceTo(0, e)}
        style={{ ...panelBase, clipPath: "inset(0 calc(100% - var(--split)) 0 0)" }}
      >
        <Panel imageUrl={sectionCoverImage(left)} />
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
      <div onClick={(e) => advanceTo(1, e)} style={{ ...panelBase, clipPath: "inset(0 0 0 var(--split))" }}>
        <Panel imageUrl={sectionCoverImage(right)} />
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "var(--split)",
          // Wider than it looks: 6px is a hard target to hit with a finger, so
          // the hit area is padded out while the visible bar stays hairline.
          width: 44,
          marginLeft: -22,
          // Driven per-frame from the position, so the line thins out and is
          // fully gone by the moment it reaches the commit bound — the stage
          // is already clear when the section opens.
          opacity: "var(--divider-fade)",
          transform: "translateZ(0)",
          willChange: "left, opacity",
          touchAction: "none",
          zIndex: 20,
          cursor: "col-resize",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* The visible bar — fades out toward top and bottom rather than
            butting flatly into the edges of the stage. */}
        <div
          style={{
            width: 2,
            height: "100%",
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.38) 18%, rgba(255,255,255,0.38) 82%, rgba(255,255,255,0) 100%)",
            opacity: raised ? 1 : 0.72,
            transition: "opacity 260ms ease",
          }}
        />
        {/* Handle pill */}
        <div
          style={{
            position: "absolute",
            width: 40,
            height: 84,
            borderRadius: 999,
            background: raised ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.14)",
            border: `1.5px solid rgba(255,255,255,${raised ? 0.55 : 0.32})`,
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            boxShadow: raised
              ? "0 8px 32px rgba(0,0,0,0.5), 0 0 24px rgba(255,255,255,0.14)"
              : "0 4px 20px rgba(0,0,0,0.4)",
            // Composited properties only, so the hover/press response never
            // competes with the drag for main-thread time.
            transform: `scale(${active ? 1.12 : hovering ? 1.06 : 1})`,
            transition: "transform 320ms cubic-bezier(0.22, 1, 0.36, 1), background 260ms ease, box-shadow 260ms ease, border-color 260ms ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          {/* Two-bar grip icon */}
          {[0, 1].map((k) => (
            <div
              key={k}
              style={{
                width: 2,
                height: 30,
                borderRadius: 2,
                background: `rgba(255,255,255,${raised ? 0.85 : 0.6})`,
                transition: "background 260ms ease",
              }}
            />
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
            fontSize: 36,
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
      draggable={false}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
    />
  ) : (
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,#141c2e 0%,#0d1224 100%)" }} />
  );
}
