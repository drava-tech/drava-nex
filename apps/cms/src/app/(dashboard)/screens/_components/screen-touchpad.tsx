"use client";

import { useCallback, useRef } from "react";
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MousePointer2,
  Minus,
  Plus,
  Search,
} from "lucide-react";
import type { DocumentKind } from "@platform/types";
import { useScreenCursorControl } from "@/hooks/useScreenCursorControl";
import { sendRemoteCommand } from "@/actions/screen-actions";
import { ZOOM_IN, ZOOM_OUT } from "@/lib/display/zoom-protocol";

/** Beyond this pointer travel (px), a press is a drag, not a tap. */
const DRAG_THRESHOLD = 6;
/** Cursor moves faster than raw finger travel, so a small pad can still reach
 * the whole screen without repeated strokes — same idea as OS trackpad acceleration. */
const CURSOR_GAIN = 1.6;
/** Scroll had no gain at all (1px drag = 1 wheel "click" via the agent's
 * mouse.scrollUp/scrollDown) — raw 1:1 felt sluggish, and small sub-1px
 * per-event deltas were silently rounded to 0 and dropped entirely. */
const SCROLL_GAIN = 4;

interface ScreenTouchpadProps {
  /** The screen whose physical PC this pad drives — see useScreenCursorControl. */
  screenId: string;
  /**
   * Which document viewer is live on the screen, from documentKindOf() in
   * @platform/types, or null/undefined for anything else. Decides whether the
   * zoom row is offered at all — the viewers are the only surfaces that answer
   * ZOOM_IN/ZOOM_OUT, and a button that silently does nothing is worse than no
   * button.
   */
  documentKind?: DocumentKind | null;
}

/**
 * A blank touch surface that drives the REAL OS-level mouse cursor on the
 * Windows PC physically showing this screen's TV, via its registered native
 * screen-agent — modeled directly on a laptop trackpad: a big drag surface,
 * a dedicated edge-scroll strip, and a horizontal-scroll strip underneath,
 * deliberately NOT a mirror/preview of the screen. Single-finger
 * drag in the main area moves the OS cursor, a tap (or the Left button)
 * clicks at that cursor, the Right button right-clicks, and a single-finger
 * drag in the right-hand strip scrolls — no two-finger gesture anywhere on
 * the pad, so there's nothing for a touch device's own pinch-zoom to
 * misfire on. Because it's real OS input, this works identically no matter
 * what's actually on screen (a browser tab, YouTube, anything else) with no
 * app-specific plumbing.
 *
 * The zoom row is the one exception to that OS-level rule: it is an
 * APP-level command (sendRemoteCommand -> SCREEN_COMMAND -> the framed
 * viewer), because the screen-agent has no keyboard binding at all — it
 * imports only mouse from nut-js — so there is no Ctrl+wheel or Ctrl+/- to
 * simulate. It is therefore shown only when a viewer that answers ZOOM_IN /
 * ZOOM_OUT is actually live; see the documentKind prop.
 *
 * There is deliberately no volume row here any more. It drove office-wide
 * system audio, which has nothing to do with the screen whose cursor this pad
 * moves, and it remains available in the three places that are about audio:
 * the action bar above this pad (live-screen-surface), the live-experience
 * dock, and the Environment Control page's Audio tile.
 */
export function ScreenTouchpad({ screenId, documentKind }: ScreenTouchpadProps) {
  const { agentOnline, moveCursor, click, scroll, scrollHorizontal } = useScreenCursorControl(screenId);

  /** Fire-and-forget: a failed zoom is a no-op the operator can simply tap
   * again, and blocking the pad on a round trip would make it feel dead. */
  const zoom = useCallback(
    (direction: "in" | "out") => {
      void sendRemoteCommand(screenId, direction === "in" ? ZOOM_IN : ZOOM_OUT).catch((err) =>
        console.error("Failed to send zoom command:", err)
      );
    },
    [screenId]
  );

  // Only one finger is ever tracked per zone — a second finger landing in the
  // same zone while one is already down is ignored, and a finger in the other
  // zone is a wholly separate gesture, tracked independently.
  const moveGestureRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    dragging: boolean;
  } | null>(null);
  const scrollGestureRef = useRef<{ id: number; lastY: number } | null>(null);
  const hScrollGestureRef = useRef<{ id: number; lastX: number } | null>(null);

  const handleMovePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (moveGestureRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    moveGestureRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      dragging: false,
    };
  }, []);

  const handleMovePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = moveGestureRef.current;
      if (!g || g.id !== e.pointerId) return;
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      if (!g.dragging && (Math.abs(e.clientX - g.startX) > DRAG_THRESHOLD || Math.abs(e.clientY - g.startY) > DRAG_THRESHOLD)) {
        g.dragging = true;
      }
      if (g.dragging) moveCursor(dx * CURSOR_GAIN, dy * CURSOR_GAIN);
    },
    [moveCursor]
  );

  const handleMovePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = moveGestureRef.current;
      if (!g || g.id !== e.pointerId) return;
      if (!g.dragging) click("left");
      moveGestureRef.current = null;
    },
    [click]
  );

  const handleScrollPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (scrollGestureRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrollGestureRef.current = { id: e.pointerId, lastY: e.clientY };
  }, []);

  const handleScrollPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = scrollGestureRef.current;
      if (!g || g.id !== e.pointerId) return;
      const dy = e.clientY - g.lastY;
      g.lastY = e.clientY;
      // Drag down pans content down = scroll UP in wheel terms, hence the negation.
      scroll(-dy * SCROLL_GAIN);
    },
    [scroll]
  );

  const handleScrollPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const g = scrollGestureRef.current;
    if (!g || g.id !== e.pointerId) return;
    scrollGestureRef.current = null;
  }, []);

  const handleHScrollPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (hScrollGestureRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    hScrollGestureRef.current = { id: e.pointerId, lastX: e.clientX };
  }, []);

  const handleHScrollPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = hScrollGestureRef.current;
      if (!g || g.id !== e.pointerId) return;
      const dx = e.clientX - g.lastX;
      g.lastX = e.clientX;
      scrollHorizontal(dx * SCROLL_GAIN);
    },
    [scrollHorizontal]
  );

  const handleHScrollPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const g = hScrollGestureRef.current;
    if (!g || g.id !== e.pointerId) return;
    hScrollGestureRef.current = null;
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ touchAction: "none", overscrollBehavior: "contain" }}>
      <div className="relative flex flex-1" style={{ touchAction: "none", overscrollBehavior: "contain" }}>
        <div
          onPointerDown={handleMovePointerDown}
          onPointerMove={handleMovePointerMove}
          onPointerUp={handleMovePointerUp}
          onPointerCancel={handleMovePointerUp}
          className="relative flex flex-1 select-none items-center justify-center bg-zinc-100 dark:bg-zinc-900"
          style={{ touchAction: "none", overscrollBehavior: "contain", cursor: "default" }}
        >
          <div className="pointer-events-none flex flex-col items-center gap-2 text-zinc-400 dark:text-zinc-600">
            <MousePointer2 className="h-6 w-6" />
            <p className="text-center text-[10px] font-bold uppercase tracking-widest">
              Drag to move · tap to click
            </p>
          </div>
        </div>

        {/* Edge-scroll strip — single-finger drag up/down, same as a laptop
            trackpad's dedicated scroll zone. Deliberately its own element
            rather than a computed region of the main pad, so ownership of a
            touch is just "which element it landed on", no bounding-rect math. */}
        <div
          onPointerDown={handleScrollPointerDown}
          onPointerMove={handleScrollPointerMove}
          onPointerUp={handleScrollPointerUp}
          onPointerCancel={handleScrollPointerUp}
          className="relative flex w-20 shrink-0 select-none flex-col items-center justify-between border-l border-[#432992] bg-zinc-200/60 py-6 dark:bg-zinc-950"
          style={{ touchAction: "none", overscrollBehavior: "contain", cursor: "default" }}
        >
          <ChevronUp className="h-4 w-4 text-zinc-400 dark:text-zinc-600" />
          <div className="w-px flex-1 bg-zinc-300 dark:bg-white/10" />
          <ChevronDown className="h-4 w-4 text-zinc-400 dark:text-zinc-600" />
        </div>
      </div>

      {/* Horizontal-scroll strip — single-finger drag left/right, same idea
          as the vertical edge-scroll strip above but for the other axis. */}
      <div
        onPointerDown={handleHScrollPointerDown}
        onPointerMove={handleHScrollPointerMove}
        onPointerUp={handleHScrollPointerUp}
        onPointerCancel={handleHScrollPointerUp}
        className="relative flex h-20 shrink-0 select-none flex-row items-center justify-between border-t border-[#432992] bg-zinc-200/60 px-6 dark:bg-zinc-950"
        style={{ touchAction: "none", overscrollBehavior: "contain", cursor: "default" }}
      >
        <ChevronLeft className="h-4 w-4 text-zinc-400 dark:text-zinc-600" />
        <div className="h-px flex-1 bg-zinc-300 dark:bg-white/10" />
        <ChevronRight className="h-4 w-4 text-zinc-400 dark:text-zinc-600" />
      </div>

      {/* Zoom row — only for the document viewers, which are the only
          surfaces that answer ZOOM_IN/ZOOM_OUT. Hidden entirely otherwise
          rather than shown disabled: the pad is used at arm's length on a
          tablet, and a greyed row there just reads as a broken control. */}
      {documentKind && (
        <div className="flex h-11 shrink-0 divide-x divide-zinc-300 border-t border-[#432992] dark:divide-white/10">
          <button
            type="button"
            onClick={() => zoom("out")}
            aria-label="Zoom out"
            className="flex flex-1 select-none items-center justify-center text-zinc-500 transition-colors hover:bg-zinc-200 active:bg-zinc-300 dark:text-zinc-400 dark:hover:bg-white/10 dark:active:bg-white/20"
          >
            <Minus className="h-4 w-4" />
          </button>
          <div className="flex flex-1 select-none items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            <Search className="h-4 w-4" />
            Zoom
          </div>
          <button
            type="button"
            onClick={() => zoom("in")}
            aria-label="Zoom in"
            className="flex flex-1 select-none items-center justify-center text-zinc-500 transition-colors hover:bg-zinc-200 active:bg-zinc-300 dark:text-zinc-400 dark:hover:bg-white/10 dark:active:bg-white/20"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}

      {agentOnline === false && (
        <p className="px-4 py-2 text-center text-xs text-amber-600 dark:text-amber-400">
          Screen agent not connected — this pad won't reach the TV.
        </p>
      )}
    </div>
  );
}
