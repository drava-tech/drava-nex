"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WsContent } from "@platform/types";

/** Must match --screen-push-duration in packages/ui/src/globals.css. */
export const PUSH_DURATION_MS = 1_500;

/**
 * Longest an armed layer waits for its own readiness signal before pushing
 * anyway. Every renderer reports ready in each of its terminal cases, success
 * or failure, so this should never fire — it exists so that content which
 * cannot report at all (a template with no first-frame signal, a viewer iframe
 * that never loads) still reaches the screen instead of freezing the panel on
 * the previous item.
 */
const READY_TIMEOUT_MS = 1_800;

/**
 * Backstop for the completion signal. animationend does not fire under
 * prefers-reduced-motion, in a backgrounded tab, or if the compositor drops the
 * animation — and a push that never completes leaves two layers mounted with
 * the incoming one's playback still deferred, i.e. a dead screen. Always the
 * loser of the race in the normal case.
 */
const COMPLETE_FALLBACK_MS = PUSH_DURATION_MS + 400;

export type PushPhase = "idle" | "armed" | "running";

export interface ContentLayer {
  content: WsContent;
  key: string;
}

interface TransitionState {
  incoming: ContentLayer;
  outgoing: ContentLayer | null;
  phase: PushPhase;
  /** Monotonic. Lets a timer or an animationend from a superseded push be ignored. */
  run: number;
}

interface UseContentTransitionArgs {
  content: WsContent;
  contentKey: string;
  /**
   * Derived DURING RENDER by the caller, and read only at the moment the key
   * changes. False for a blanked screen, reduced motion, or a panel opted out
   * with ?pushTransition=0.
   */
  enabled: boolean;
}

interface UseContentTransitionReturn {
  incoming: ContentLayer;
  outgoing: ContentLayer | null;
  phase: PushPhase;
  /** Keyed, so a late signal from a layer that has already been superseded cannot advance this one. */
  markReady: (key: string) => void;
  incomingRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Drives the two-layer push-up transition.
 *
 *   idle ──push──▶ armed ──ready──▶ running ──animationend──▶ idle
 *                    │                                          ▲
 *                    └────────── ready timeout ──────────────────┘
 *
 * `armed` is the part that makes the transition visible at all. The previous
 * implementation animated a single layer from mount, so the box slid up while
 * still empty and the content appeared at its final position once the slide was
 * over — a video waits for canplay, an iframe for a whole document load. Here
 * the incoming layer mounts parked below the bottom edge with the old content
 * still on screen and still playing, and only starts moving once it reports
 * that its first frame is decoded.
 */
export function useContentTransition({
  content,
  contentKey,
  enabled,
}: UseContentTransitionArgs): UseContentTransitionReturn {
  const incomingRef = useRef<HTMLDivElement | null>(null);

  const [state, setState] = useState<TransitionState>({
    incoming: { content, key: contentKey },
    outgoing: null,
    phase: "idle",
    run: 0,
  });

  // The swap is derived DURING RENDER (React's adjust-state-on-prop-change
  // pattern), never in an effect. Both layers have to mount in the same commit:
  // an effect renders one frame with the new content already alone on screen,
  // which is the pop this whole hook exists to remove — the same one-render-late
  // failure that LiveScreenPlayer's reveal-suppression comment describes.
  const [lastKey, setLastKey] = useState(contentKey);
  if (lastKey !== contentKey) {
    setLastKey(contentKey);
    setState((prev) => {
      const next: ContentLayer = { content, key: contentKey };
      // A new key arriving mid-push re-arms with the layer that was entering as
      // the new outgoing; the one that was leaving snaps away. Only reachable
      // with two pushes less than PUSH_DURATION_MS apart, where it reads as a
      // rapid chain rather than a glitch — deliberately not worth more machinery.
      return enabled
        ? { incoming: next, outgoing: prev.incoming, phase: "armed", run: prev.run + 1 }
        : { incoming: next, outgoing: null, phase: "idle", run: prev.run + 1 };
    });
  }

  const markReady = useCallback((key: string) => {
    setState((prev) =>
      prev.phase === "armed" && prev.incoming.key === key ? { ...prev, phase: "running" } : prev
    );
  }, []);

  const { phase, run } = state;

  useEffect(() => {
    if (phase !== "armed") return;
    const timer = setTimeout(
      () => setState((prev) => (prev.phase === "armed" ? { ...prev, phase: "running" } : prev)),
      READY_TIMEOUT_MS
    );
    return () => clearTimeout(timer);
  }, [phase, run]);

  useEffect(() => {
    if (phase !== "running") return;

    const finish = () =>
      setState((prev) =>
        prev.phase === "running" ? { ...prev, outgoing: null, phase: "idle" } : prev
      );

    const node = incomingRef.current;
    // Name-matched: the layer's subtree contains renderers with animations of
    // their own (ExperienceDisplay's slides, a template's intro), and those
    // bubble here too.
    const onEnd = (e: AnimationEvent) => {
      if (e.animationName === "screen-push-in") finish();
    };
    node?.addEventListener("animationend", onEnd);
    const timer = setTimeout(finish, COMPLETE_FALLBACK_MS);

    return () => {
      node?.removeEventListener("animationend", onEnd);
      clearTimeout(timer);
    };
  }, [phase, run]);

  return {
    incoming: state.incoming,
    outgoing: state.outgoing,
    phase,
    markReady,
    incomingRef,
  };
}
