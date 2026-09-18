// Ported from cms-platform apps/cms/src/hooks/useContentPreloader.ts (the
// template-specific branch removed — this product has no templates).

import { useCallback, useEffect, useRef, useState } from "react"
import type { ScreenContent } from "@workspace/types"

interface PreloadState {
  active: ScreenContent
  activeKey: string
  staged: ScreenContent | null
  stagedKey: string | null
}

/**
 * Buffers incoming content before it is allowed to become active, so a push
 * never starts from an empty buffer. Identical content (same key) is ignored,
 * which is why a reconnect's WELCOME for what is already showing does nothing.
 */
export function useContentPreloader(initial: ScreenContent) {
  const [state, setState] = useState<PreloadState>({
    active: initial,
    activeKey: getContentKey(initial),
    staged: null,
    stagedKey: null,
  })
  const preloadAbortRef = useRef<AbortController | null>(null)

  const queueContent = useCallback((incoming: ScreenContent) => {
    const incomingKey = getContentKey(incoming)
    setState((prev) => {
      if (prev.activeKey === incomingKey || prev.stagedKey === incomingKey) return prev
      return { ...prev, staged: incoming, stagedKey: incomingKey }
    })
  }, [])

  useEffect(() => {
    if (!state.staged || !state.stagedKey) return
    const content = state.staged
    const contentKey = state.stagedKey

    preloadAbortRef.current?.abort()
    preloadAbortRef.current = new AbortController()
    const { signal } = preloadAbortRef.current

    let cancelled = false
    signal.addEventListener("abort", () => {
      cancelled = true
    })

    const promote = () => {
      if (!cancelled) setState({ active: content, activeKey: contentKey, staged: null, stagedKey: null })
    }

    if (content.type === "image") {
      const img = new Image()
      img.onload = promote
      img.onerror = promote // still switch even if preload fails
      img.src = content.source
    } else if (content.type === "video" && content.source) {
      const video = document.createElement("video")
      video.preload = "auto"
      const timer = setTimeout(promote, 3_000) // max 3 s wait
      // Releasing the element is not optional housekeeping. Without it this
      // detached <video> keeps pulling the whole file while the renderer's real
      // element pulls the same URL — every push downloads the video twice.
      // Clearing src and calling load() aborts the fetch; the real element then
      // reads from the HTTP cache.
      const release = () => {
        clearTimeout(timer)
        video.oncanplaythrough = null
        video.onerror = null
        video.removeAttribute("src")
        video.load()
      }
      video.oncanplaythrough = () => {
        release()
        promote()
      }
      video.onerror = () => {
        release()
        promote()
      }
      video.src = content.source
      video.load()
      // Also covers the staged item changing again before this one buffered.
      return release
    } else {
      promote() // html / idle: nothing to buffer
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stagedKey])

  return { activeContent: state.active, activeKey: state.activeKey, queueContent }
}

/**
 * Identity of a piece of content. Includes `source`, which is why media URLs
 * must be stable: a URL that changed on every resolve (a presigned one) would
 * make every reconnect look like new content and replay the transition.
 */
export function getContentKey(content: ScreenContent): string {
  return JSON.stringify([
    content.id,
    content.type,
    content.source,
    content.loop ?? null,
    content.muted ?? null,
    content.title ?? null,
  ])
}
