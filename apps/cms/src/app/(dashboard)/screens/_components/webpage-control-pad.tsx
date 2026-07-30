"use client";

import { useCallback, useRef } from "react";
import { ArrowLeft, ArrowRight, RotateCw, MousePointer2 } from "lucide-react";
import { useBrowserSession } from "@platform/ui/browser-session";

/** Beyond this pointer travel (px), a press is a drag, not a tap. */
const DRAG_THRESHOLD = 6;
/** Cursor moves faster than raw finger travel, so a small pad can still reach
 * the whole page without repeated strokes — same idea as OS trackpad acceleration. */
const CURSOR_GAIN = 1.6;

interface WebpageControlPadProps {
  /** Deterministic sessionId to join — same shape as WebpageRenderer's `webpage:${assetId}`, so this joins the SAME shared Puppeteer session the real screen (and its passive mirror) are already running. */
  sessionId: string;
  /** Best-effort URL, only used if this pad happens to be the first client to open the session — in normal use the screen/mirror already started it, so this is rarely consulted. */
  url: string;
}

/**
 * A blank touch surface that drives an already-live browser-render session by
 * relative motion, like a laptop trackpad or a "phone as TV remote" app —
 * deliberately NOT a mirror of the page. Single-finger drag moves the
 * renderer's own tracked cursor, a tap clicks at that cursor, two fingers
 * scroll. Pair with a passive (non-interactive) ScreenMirror elsewhere on
 * screen as "the display" — this component is purely the input side.
 */
export function WebpageControlPad({ sessionId, url }: WebpageControlPadProps) {
  const session = useBrowserSession(url, { interactive: true, sessionId });

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
        // Two-finger drag = scroll — same drag-to-pan convention as the
        // existing single-finger mirror gesture (drag down = content pans
        // down = scroll UP in wheel terms, hence the negation).
        session.scroll(-dy);
        return;
      }

      const g = gestureRef.current;
      if (!g || g.id !== e.pointerId) return;
      if (!g.dragging && (Math.abs(e.clientX - g.startX) > DRAG_THRESHOLD || Math.abs(e.clientY - g.startY) > DRAG_THRESHOLD)) {
        g.dragging = true;
      }
      if (g.dragging) session.moveCursor(dx * CURSOR_GAIN, dy * CURSOR_GAIN);
    },
    [session]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(e.pointerId);
      const g = gestureRef.current;
      if (g && g.id === e.pointerId) {
        if (!g.dragging) session.clickAtCursor();
        gestureRef.current = null;
      }
    },
    [session]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-center gap-1 border-b border-zinc-200 bg-white px-4 py-2 dark:border-white/10 dark:bg-[#0a0a0a]">
        <PadButton onClick={session.goBack} disabled={!session.canGoBack} label="Back">
          <ArrowLeft className="h-4 w-4" />
        </PadButton>
        <PadButton onClick={session.goForward} disabled={!session.canGoForward} label="Forward">
          <ArrowRight className="h-4 w-4" />
        </PadButton>
        <PadButton onClick={session.reload} disabled={!session.ready} label="Reload">
          <RotateCw className="h-4 w-4" />
        </PadButton>
      </div>
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
      {session.error && (
        <p className="px-4 py-2 text-center text-xs text-red-600 dark:text-red-400">{session.error}</p>
      )}
    </div>
  );
}

function PadButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
    >
      {children}
    </button>
  );
}
