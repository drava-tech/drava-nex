"use client";

import { useRef } from "react";

/**
 * Hidden escape hatch for the TV: five taps in the top-left corner within 2s
 * fire `onTrigger` (LiveScreenPlayer toggles fullscreen with it).
 *
 * A corner hotspot rather than a window-level listener, because the content is
 * often a cross-origin iframe (webpage/YouTube renderers) whose taps never
 * reach this document at all. Sits above the blackout overlay (z-50) so the
 * gesture still works while the screen is blanked.
 */
export function FiveTapCorner({ onTrigger }: { onTrigger: () => void }) {
  const taps = useRef<number[]>([]);

  return (
    <div
      aria-hidden
      className="fixed left-0 top-0 z-[9999] h-[10vmin] w-[10vmin] min-h-16 min-w-16"
      onPointerDown={() => {
        const now = Date.now();
        taps.current = [...taps.current, now].filter((t) => now - t < 2000);
        if (taps.current.length < 5) return;
        taps.current = [];
        onTrigger();
      }}
    />
  );
}
