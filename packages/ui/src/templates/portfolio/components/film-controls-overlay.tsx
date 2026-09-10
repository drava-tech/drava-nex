"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { FastForward, Pause, Play, Rewind } from "lucide-react";
import { SEEK_STEP_SECONDS, type FilmPlayback } from "./use-film-playback";

/** Idle time before the chrome fades out again — matches VideoControlsOverlay. */
const CONTROLS_IDLE_MS = 3000;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Transport controls drawn over a portfolio video, for someone standing at the
 * 86" panel — and, unchanged, for an operator clicking the same page inside the
 * CMS mirror. What each button does travels over the WS; see useFilmPlayback.
 *
 * This is VideoControlsOverlay's bar rebuilt for the template's own surface, and
 * the two differences from it are both about where it lives:
 *
 *  - Authored in real 1920×1080 pixels, like everything else inside
 *    ScreenStage, which CSS-transform-scales the whole stage to the panel. A
 *    rem-sized dashboard control would be scaled twice and come out wrong.
 *  - The idle timer is fed by the PLAYER's pointer events (`surfaceRef`) rather
 *    than the window's. The same template renders inside the CMS editor, where
 *    a window listener would reveal this bar every time the mouse crossed the
 *    dashboard around it.
 *
 * It keeps VideoControlsOverlay's third property, which is load-bearing on a
 * touchscreen: `pointer-events: none` while hidden, so a tap aimed at an
 * invisible button passes through to the video and only reveals.
 */
export function FilmControlsOverlay({
  playback,
  surfaceRef,
}: {
  playback: FilmPlayback;
  /**
   * The player box. Pointer activity anywhere inside it reveals the bar; the
   * bar itself is inside it too, so using a control keeps it awake.
   */
  surfaceRef?: RefObject<HTMLElement | null>;
}) {
  const { time, duration, playing, togglePlay, seekBy, beginScrub, scrubTo, endScrub } = playback;

  const [visible, setVisible] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  /** Position under the thumb while dragging; the prop wins when not dragging. */
  const [local, setLocal] = useState(0);

  const reveal = useCallback(() => {
    setVisible(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setVisible(false), CONTROLS_IDLE_MS);
  }, []);

  // Shown on arrival and then faded, so the affordance is discoverable — a
  // visitor has no way to guess at a bar that has never been on screen.
  useEffect(() => {
    reveal();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [reveal]);

  // A touch panel produces no pointermove until a finger lands, so pointerdown
  // is what matters here. Passive by design — it reveals and nothing else.
  useEffect(() => {
    // EventTarget, not HTMLElement | Window: only addEventListener is wanted
    // here, and the union of the two element types has no shared overload.
    const target: EventTarget | null =
      surfaceRef?.current ?? (typeof window === "undefined" ? null : window);
    if (!target) return;
    const onInteract = () => reveal();
    target.addEventListener("pointerdown", onInteract);
    target.addEventListener("pointermove", onInteract);
    return () => {
      target.removeEventListener("pointerdown", onInteract);
      target.removeEventListener("pointermove", onInteract);
    };
  }, [reveal, surfaceRef]);

  // The stage is CSS-transform-scaled, so the element's rect and the pointer's
  // clientX are both in scaled viewport space — a ratio of the two is correct at
  // any scale, where anything offset-based would not be.
  const valueAt = (clientX: number): number => {
    const el = trackRef.current;
    if (!el || duration <= 0) return 0;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return 0;
    const x = Math.max(0, Math.min(clientX - r.left, r.width));
    return (x / r.width) * duration;
  };

  const scrubbable = duration > 0;
  const shown = dragging ? local : time;
  const pct = scrubbable ? Math.min(100, Math.max(0, (shown / duration) * 100)) : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        // Above the page's own edge arrows and pill (z 5), far below the
        // display shell's five-tap escape hatch, which must always win.
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "120px 56px 40px",
        background: "linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.82))",
        // Matches the 18px both hosts round their video box to. The films
        // player clips it anyway (overflow: hidden); the popup does not.
        borderBottomLeftRadius: 18,
        borderBottomRightRadius: 18,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 300ms ease",
      }}
    >
      {/* No preview thumbnail, deliberately. The panel behind this bar is
          already showing the scrubbed frame at full size — the film pauses and
          seeks along with the drag — so a small copy of it would add nothing
          and cost the kiosk a second decoder alongside the one already playing. */}
      <div
        ref={trackRef}
        role="slider"
        aria-label="Seek"
        aria-valuenow={Math.round(shown)}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration) || 1}
        aria-disabled={!scrubbable}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          // A tall transparent hit area around a thin visible track: easy to
          // grab with a finger without making the control look heavy.
          height: 48,
          width: "100%",
          touchAction: "none",
          cursor: scrubbable ? "pointer" : "default",
          opacity: scrubbable ? 1 : 0.4,
        }}
        onPointerDown={(e) => {
          if (!scrubbable) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const v = valueAt(e.clientX);
          setDragging(true);
          setLocal(v);
          beginScrub();
          scrubTo(v);
          reveal();
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          const v = valueAt(e.clientX);
          // Local state drives the thumb so it tracks the finger exactly, while
          // scrubTo decides how much of that reaches the decoder. Without this
          // split the thumb would visibly lag its own rate gate.
          setLocal(v);
          scrubTo(v);
          reveal();
        }}
        onPointerUp={(e) => {
          if (!dragging) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          const v = valueAt(e.clientX);
          setDragging(false);
          setLocal(v);
          endScrub(v);
          reveal();
        }}
        onPointerCancel={() => {
          if (!dragging) return;
          setDragging(false);
          // Still an end: the session has to close or playback never resumes.
          endScrub(local);
        }}
      >
        <div style={{ height: 8, width: "100%", borderRadius: 999, background: "rgba(255,255,255,0.25)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              borderRadius: 999,
              background: "#ffffff",
              transition: dragging ? "none" : "width 150ms ease-out",
            }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            left: `${pct}%`,
            // Centred explicitly rather than leaning on the flex container's
            // static position for an absolutely positioned child.
            top: "50%",
            width: 26,
            height: 26,
            marginLeft: -13,
            marginTop: -13,
            borderRadius: 999,
            background: "#ffffff",
            boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
            pointerEvents: "none",
            transition: dragging ? "none" : "left 150ms ease-out",
          }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <TransportButton
          onClick={() => {
            seekBy(-SEEK_STEP_SECONDS);
            reveal();
          }}
          label={`Rewind ${SEEK_STEP_SECONDS} seconds`}
          size={72}
        >
          <Rewind size={36} />
        </TransportButton>
        <TransportButton
          onClick={() => {
            togglePlay();
            reveal();
          }}
          label={playing ? "Pause" : "Play"}
          size={88}
          filled
        >
          {playing ? <Pause size={44} /> : <Play size={44} style={{ marginLeft: 4 }} />}
        </TransportButton>
        <TransportButton
          onClick={() => {
            seekBy(SEEK_STEP_SECONDS);
            reveal();
          }}
          label={`Forward ${SEEK_STEP_SECONDS} seconds`}
          size={72}
        >
          <FastForward size={36} />
        </TransportButton>

        <span
          style={{
            marginLeft: 12,
            fontSize: 28,
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
            color: "rgba(255,255,255,0.75)",
          }}
        >
          {formatTime(shown)}
          {duration > 0 ? ` / ${formatTime(duration)}` : ""}
        </span>
      </div>
    </div>
  );
}

function TransportButton({
  onClick,
  label,
  size,
  filled = false,
  children,
}: {
  onClick: () => void;
  label: string;
  size: number;
  filled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: "none",
        background: filled ? "rgba(255,255,255,0.18)" : "transparent",
        color: filled ? "#ffffff" : "rgba(255,255,255,0.8)",
      }}
    >
      {children}
    </button>
  );
}
