"use client";

import { useCallback, useRef } from "react";
import { MousePointer2 } from "lucide-react";
import { useScreenCursorControl } from "@/hooks/useScreenCursorControl";

/** Beyond this pointer travel (px), a press is a drag, not a tap. */
const DRAG_THRESHOLD = 6;
/** Cursor moves faster than raw finger travel, so a small pad can still reach
 * the whole screen without repeated strokes — same idea as OS trackpad acceleration. */
const CURSOR_GAIN = 1.6;

interface ScreenTouchpadProps {
  /** The screen whose physical PC this pad drives — see useScreenCursorControl. */
  screenId: string;
}

/**
 * A blank touch surface that drives the REAL OS-level mouse cursor on the
 * Windows PC physically showing this screen's TV, via its registered native
 * screen-agent — like a laptop trackpad or a "phone as TV remote" app,
 * deliberately NOT a mirror/preview of the screen. Single-finger drag moves
 * the OS cursor, a tap clicks at that cursor, two fingers scroll. Because
 * it's real OS input, this works identically no matter what's actually on
 * screen (a browser tab, YouTube, anything else) with no app-specific
 * plumbing.
 */
export function ScreenTouchpad({ screenId }: ScreenTouchpadProps) {
  const { agentOnline, moveCursor, click, scroll } = useScreenCursorControl(screenId);

  // Tracks every currently-down pointer so a second finger joining mid-touch
  // switches the gesture from tap/drag to two-finger scroll.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{ id: number; startX: number; startY: number; dragging: boolean } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      gestureRef.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false };
    } else {
      // A second finger joined — this is a scroll gesture, not a tap/click.
      gestureRef.current = null;
    }
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const prev = pointersRef.current.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size >= 2) {
        // Two-finger drag = scroll — drag down pans content down = scroll UP
        // in wheel terms, hence the negation.
        scroll(-dy);
        return;
      }

      const g = gestureRef.current;
      if (!g || g.id !== e.pointerId) return;
      if (!g.dragging && (Math.abs(e.clientX - g.startX) > DRAG_THRESHOLD || Math.abs(e.clientY - g.startY) > DRAG_THRESHOLD)) {
        g.dragging = true;
      }
      if (g.dragging) moveCursor(dx * CURSOR_GAIN, dy * CURSOR_GAIN);
    },
    [moveCursor, scroll]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(e.pointerId);
      const g = gestureRef.current;
      if (g && g.id === e.pointerId) {
        if (!g.dragging) click();
        gestureRef.current = null;
      }
    },
    [click]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative flex flex-1 select-none items-center justify-center bg-zinc-100 dark:bg-zinc-900"
        style={{ touchAction: "none", cursor: "default" }}
      >
        <div className="pointer-events-none flex flex-col items-center gap-2 text-zinc-400 dark:text-zinc-600">
          <MousePointer2 className="h-6 w-6" />
          <p className="text-center text-[10px] font-bold uppercase tracking-widest">
            Drag to move · tap to click
            <br />
            two fingers to scroll
          </p>
        </div>
      </div>
      {agentOnline === false && (
        <p className="px-4 py-2 text-center text-xs text-amber-600 dark:text-amber-400">
          Screen agent not connected — this pad won't reach the TV.
        </p>
      )}
    </div>
  );
}
