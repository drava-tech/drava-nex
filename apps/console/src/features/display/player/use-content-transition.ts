// Ported verbatim (bar the content type) from cms-platform
// apps/cms/src/hooks/useContentTransition.ts. The behaviour here is the
// product of failures that were only visible on a wall; change it deliberately.

import { useCallback, useEffect, useRef, useState } from "react"
import type { ScreenContent } from "@workspace/types"

/** Must match --screen-push-duration in ./player.css. */
export const PUSH_DURATION_MS = 1_500

/**
 * Longest an armed layer waits for its own readiness signal before pushing
 * anyway. Every renderer reports ready in each of its terminal cases, success
 * or failure, so this should never fire — it exists so that content which
 * cannot report at all (a viewer iframe that never loads) still reaches the
 * screen instead of freezing the panel on the previous item.
 */
const READY_TIMEOUT_MS = 1_800

/**
 * Backstop for the completion signal. animationend does not fire under
 * prefers-reduced-motion, in a backgrounded tab, or if the compositor drops the
 * animation — and a push that never completes leaves two layers mounted with
 * the incoming one's playback still deferred, i.e. a dead screen. Always the
 * loser of the race in the normal case.
 */
const COMPLETE_FALLBACK_MS = PUSH_DURATION_MS + 400

export type PushPhase = "idle" | "armed" | "running"

export interface ContentLayer {
  content: ScreenContent
  key: string
}

interface TransitionState {
  incoming: ContentLayer
  outgoing: ContentLayer | null
  phase: PushPhase
  /** Monotonic. Lets a timer or an animationend from a superseded push be ignored. */
  run: number
}

interface UseContentTransitionArgs {
  content: ScreenContent
  contentKey: string
  /**
   * Derived DURING RENDER by the caller, and read only at the moment the key
   * changes. False for a blanked screen, reduced motion, or a panel opted out
   * with ?pushTransition=0.
   */
  enabled: boolean
}

/**
 * Drives the two-layer push-up transition.
 *
 *   idle ──push──▶ armed ──ready──▶ running ──animationend──▶ idle
 *                    │                                          ▲
 *                    └────────── ready timeout ──────────────────┘
 *
 * `armed` is what makes the transition visible at all: the incoming layer
 * mounts parked below the bottom edge with the old content still on screen and
 * still playing, and only starts moving once it reports that its first frame
 * is decoded. Animating from mount instead slides an empty box up and pops the
 * content in afterwards.
 */
export function useContentTransition({ content, contentKey, enabled }: UseContentTransitionArgs) {
  const incomingRef = useRef<HTMLDivElement | null>(null)

  const [state, setState] = useState<TransitionState>({
    incoming: { content, key: contentKey },
    outgoing: null,
    phase: "idle",
    run: 0,
  })

  // The swap is derived DURING RENDER (React's adjust-state-on-prop-change
  // pattern), never in an effect. Both layers have to mount in the same commit:
  // an effect renders one frame with the new content already alone on screen,
  // which is the pop this whole hook exists to remove.
  const [lastKey, setLastKey] = useState(contentKey)
  if (lastKey !== contentKey) {
    setLastKey(contentKey)
    setState((prev) => {
      const next: ContentLayer = { content, key: contentKey }
      // A new key arriving mid-push re-arms with the layer that was entering as
      // the new outgoing; the one that was leaving snaps away. Only reachable
      // with two pushes less than PUSH_DURATION_MS apart.
      return enabled
        ? { incoming: next, outgoing: prev.incoming, phase: "armed", run: prev.run + 1 }
        : { incoming: next, outgoing: null, phase: "idle", run: prev.run + 1 }
    })
  }

  const markReady = useCallback((key: string) => {
    setState((prev) =>
      prev.phase === "armed" && prev.incoming.key === key ? { ...prev, phase: "running" } : prev
    )
  }, [])

  const { phase, run } = state

  useEffect(() => {
    if (phase !== "armed") return
    const timer = setTimeout(
      () => setState((prev) => (prev.phase === "armed" ? { ...prev, phase: "running" } : prev)),
      READY_TIMEOUT_MS
    )
    return () => clearTimeout(timer)
  }, [phase, run])

  useEffect(() => {
    if (phase !== "running") return

    const finish = () =>
      setState((prev) => (prev.phase === "running" ? { ...prev, outgoing: null, phase: "idle" } : prev))

    const node = incomingRef.current
    // Name-matched: renderers' own animations bubble here too.
    const onEnd = (e: AnimationEvent) => {
      if (e.animationName === "screen-push-in") finish()
    }
    node?.addEventListener("animationend", onEnd)
    const timer = setTimeout(finish, COMPLETE_FALLBACK_MS)

    return () => {
      node?.removeEventListener("animationend", onEnd)
      clearTimeout(timer)
    }
  }, [phase, run])

  return { incoming: state.incoming, outgoing: state.outgoing, phase, markReady, incomingRef }
}
