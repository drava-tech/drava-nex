"use client";

import { useEffect, useRef } from "react";

/** Taps required, and the window they all have to land inside. */
const TAP_COUNT = 5;
const TAP_WINDOW_MS = 2000;

/** Matches the overlay's Tailwind box below: 10vmin, never under 64px. */
const cornerSize = () => Math.max(64, 0.1 * Math.min(window.innerWidth, window.innerHeight));

/**
 * Controls the gesture must leave alone. A 10vmin corner is a big target on a
 * 1080p screen — 108px — and the Portfolio's back button sits at 48,36 with a
 * 64px box, so it lands almost entirely inside. Taps on a real control neither
 * count towards the five nor are consumed; the bare corner around it still
 * works, which is where the gesture is aimed anyway.
 */
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"]';

/**
 * Hidden escape hatch for the TV: five taps in the top-left corner within 2s
 * fire `onTrigger` (LiveScreenPlayer toggles fullscreen with it).
 *
 * Listens on the document in the capture phase rather than parking a hit target
 * over the corner, so the gesture costs nothing: it never calls
 * stopPropagation, so the tap still reaches whatever is underneath.
 *
 * `overlay` brings the old hit target back, and is for content rendered in a
 * cross-origin iframe (the webpage/YouTube renderers), whose taps never reach
 * this document for a listener to see. There the overlay is the only thing that
 * works — and it costs nothing either, since the corner of an embedded page has
 * no control of ours in it.
 */
export function FiveTapCorner({
  onTrigger,
  overlay = false,
}: {
  onTrigger: () => void;
  /** True only for iframe-rendered content — see above. */
  overlay?: boolean;
}) {
  const taps = useRef<number[]>([]);
  // Kept in a ref so an inline callback from the parent doesn't resubscribe the
  // document listener on every render.
  const trigger = useRef(onTrigger);
  trigger.current = onTrigger;

  /** Records a tap; true once five have landed inside the window. */
  const register = (): boolean => {
    const now = Date.now();
    taps.current = [...taps.current, now].filter((t) => now - t < TAP_WINDOW_MS);
    if (taps.current.length < TAP_COUNT) return false;
    taps.current = [];
    return true;
  };

  useEffect(() => {
    if (overlay) return;
    const onPointerDown = (e: PointerEvent) => {
      const size = cornerSize();
      if (e.clientX > size || e.clientY > size) return;
      if ((e.target as Element | null)?.closest?.(INTERACTIVE)) return;
      if (register()) trigger.current();
    };
    // Capture, so the tap is seen wherever it lands — including on an element
    // that stops propagation on its way up.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [overlay]);

  if (!overlay) return null;

  return (
    <div
      aria-hidden
      className="fixed left-0 top-0 z-[9999] h-[10vmin] w-[10vmin] min-h-16 min-w-16"
      onPointerDown={() => {
        if (register()) trigger.current();
      }}
    />
  );
}
