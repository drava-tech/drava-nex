"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_IDLE_MS = 60_000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

/**
 * Auto-navigates to `returnPath` after `idleMs` of no user interaction
 * (pointer, keyboard, touch, wheel) — the timer resets on every interaction.
 * A no-op when `returnPath` is omitted, so callers can pass an optional prop
 * straight through without branching. Used on operator-facing control pages
 * reached from a specific "home" (e.g. /push/live/<deviceId>, reached from
 * /push) so walking away eventually lands back there instead of leaving the
 * live control page open indefinitely.
 */
export function useIdleAutoReturn(returnPath: string | undefined, idleMs: number = DEFAULT_IDLE_MS): void {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!returnPath) return;

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => router.push(returnPath), idleMs);
    };

    resetTimer();
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, resetTimer);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, resetTimer);
    };
  }, [returnPath, idleMs, router]);
}
