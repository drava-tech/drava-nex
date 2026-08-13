"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronUp, ChevronDown, MousePointer2, Minus, Plus, Volume2, VolumeX } from "lucide-react";
import { useScreenCursorControl } from "@/hooks/useScreenCursorControl";

/** Beyond this pointer travel (px), a press is a drag, not a tap. */
const DRAG_THRESHOLD = 6;
/** Cursor moves faster than raw finger travel, so a small pad can still reach
 * the whole screen without repeated strokes — same idea as OS trackpad acceleration. */
const CURSOR_GAIN = 1.6;
/** Scroll had no gain at all (1px drag = 1 wheel "click" via the agent's
 * mouse.scrollUp/scrollDown) — raw 1:1 felt sluggish, and small sub-1px
 * per-event deltas were silently rounded to 0 and dropped entirely. */
const SCROLL_GAIN = 4;
/** Per-tap step for the touchpad's +/- buttons — bigger than a slider's fine
 * drag resolution since a tap is a discrete, deliberate action. */
const VOLUME_STEP = 5;

interface ScreenTouchpadProps {
  /** The screen whose physical PC this pad drives — see useScreenCursorControl. */
  screenId: string;
}

/**
 * A blank touch surface that drives the REAL OS-level mouse cursor on the
 * Windows PC physically showing this screen's TV, via its registered native
 * screen-agent — modeled directly on a laptop trackpad: a big drag surface,
 * a dedicated edge-scroll strip, a volume row, and a left/right button bar
 * underneath, deliberately NOT a mirror/preview of the screen. Single-finger
 * drag in the main area moves the OS cursor, a tap (or the Left button)
 * clicks at that cursor, the Right button right-clicks, and a single-finger
 * drag in the right-hand strip scrolls — no two-finger gesture anywhere on
 * the pad, so there's nothing for a touch device's own pinch-zoom to
 * misfire on. Because it's real OS input, this works identically no matter
 * what's actually on screen (a browser tab, YouTube, anything else) with no
 * app-specific plumbing.
 *
 * The volume row is the same office-wide system audio endpoint the
 * Environment Control page's Audio tile uses (apps/api/src/routes/audio.ts,
 * backed by the native audio-helper bridge) — one physical PC's speakers,
 * not per-screen audio, so it controls whatever's actually wired to sound
 * regardless of which screen's touchpad you're on.
 */
export function ScreenTouchpad({ screenId }: ScreenTouchpadProps) {
  const { agentOnline, moveCursor, click, scroll } = useScreenCursorControl(screenId);

  // --- Volume (existing global /api/audio endpoint — see docblock above) ---
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/audio/status")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (typeof data?.volume === "number") setVolume(data.volume);
        if (typeof data?.muted === "boolean") setMuted(data.muted);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const adjustVolume = useCallback(
    (delta: number) => {
      const base = muted ? 0 : volume;
      const next = Math.max(0, Math.min(100, base + delta));
      setVolume(next);
      setMuted(false);
      fetch("/api/audio/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volume: next }),
      }).catch(() => {});
    },
    [volume, muted]
  );

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    fetch("/api/audio/toggle-mute", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (typeof data?.muted === "boolean") setMuted(data.muted);
      })
      .catch(() => {});
  }, [muted]);

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
          className="relative flex w-20 shrink-0 select-none flex-col items-center justify-between border-l border-zinc-300 bg-zinc-200/60 py-6 dark:border-white/10 dark:bg-zinc-950"
          style={{ touchAction: "none", overscrollBehavior: "contain", cursor: "default" }}
        >
          <ChevronUp className="h-4 w-4 text-zinc-400 dark:text-zinc-600" />
          <div className="w-px flex-1 bg-zinc-300 dark:bg-white/10" />
          <ChevronDown className="h-4 w-4 text-zinc-400 dark:text-zinc-600" />
        </div>
      </div>

      {/* Volume row — office system audio, see docblock above. */}
      <div className="flex h-11 shrink-0 divide-x divide-zinc-300 border-t border-zinc-300 dark:divide-white/10 dark:border-white/10">
        <button
          type="button"
          onClick={() => adjustVolume(-VOLUME_STEP)}
          aria-label="Decrease volume"
          className="flex flex-1 select-none items-center justify-center text-zinc-500 transition-colors hover:bg-zinc-200 active:bg-zinc-300 dark:text-zinc-400 dark:hover:bg-white/10 dark:active:bg-white/20"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          className={`flex flex-1 select-none items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
            muted
              ? "text-red-600 dark:text-red-400"
              : "text-zinc-500 hover:bg-zinc-200 active:bg-zinc-300 dark:text-zinc-400 dark:hover:bg-white/10 dark:active:bg-white/20"
          }`}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          {muted ? "Muted" : `${volume}%`}
        </button>
        <button
          type="button"
          onClick={() => adjustVolume(VOLUME_STEP)}
          aria-label="Increase volume"
          className="flex flex-1 select-none items-center justify-center text-zinc-500 transition-colors hover:bg-zinc-200 active:bg-zinc-300 dark:text-zinc-400 dark:hover:bg-white/10 dark:active:bg-white/20"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Laptop-trackpad-style button bar — explicit left/right clicks
          alongside the pad's own tap-to-left-click gesture above. */}
      <div className="flex h-11 shrink-0 divide-x divide-zinc-300 border-t border-zinc-300 dark:divide-white/10 dark:border-white/10">
        <button
          type="button"
          onClick={() => click("left")}
          className="flex-1 select-none text-[10px] font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:bg-zinc-200 active:bg-zinc-300 dark:text-zinc-400 dark:hover:bg-white/10 dark:active:bg-white/20"
        >
          Left
        </button>
        <button
          type="button"
          onClick={() => click("right")}
          className="flex-1 select-none text-[10px] font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:bg-zinc-200 active:bg-zinc-300 dark:text-zinc-400 dark:hover:bg-white/10 dark:active:bg-white/20"
        >
          Right
        </button>
      </div>
      {agentOnline === false && (
        <p className="px-4 py-2 text-center text-xs text-amber-600 dark:text-amber-400">
          Screen agent not connected — this pad won't reach the TV.
        </p>
      )}
    </div>
  );
}
