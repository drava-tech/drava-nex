import "./player.css"

import { useEffect, useRef } from "react"
import type { ScreenContent } from "@workspace/types"

import { cn } from "@workspace/ui/lib/utils"
import { ContentRenderer, IdleDisplay } from "./renderers"
import { useAudioKeepAlive } from "./use-audio-keep-alive"
import { useContentPreloader } from "./use-content-preloader"
import { useContentTransition, type ContentLayer } from "./use-content-transition"
import { isPushTransitionEnabled } from "./transition-config"

type Props = {
  content: ScreenContent
  blanked: boolean
  /** Shown on the idle screen. */
  name?: string | undefined
  /** A console preview: silent, and reduced-motion is honoured. */
  preview?: boolean
  /** Fill the parent box instead of the viewport (the console preview). */
  contained?: boolean
}

/**
 * Renders whatever `content` says, with the push-up transition between items.
 * Pure: it knows nothing about sockets — the live display feeds it from the
 * gateway, the console preview from its own state.
 */
export function ScreenPlayer({ content, blanked, name, preview = false, contained = false }: Props) {
  const { activeContent, activeKey, queueContent } = useContentPreloader(content)
  useEffect(() => queueContent(content), [content, queueContent])

  // Keeps the audio output open across pushes; must outlive every renderer.
  useAudioKeepAlive(!preview)

  // Whether this panel animates is a property of the installation — read once.
  const pushOkRef = useRef<boolean | null>(null)
  if (pushOkRef.current === null) pushOkRef.current = isPushTransitionEnabled(preview)

  // Derived during render, NOT in an effect: it decides how the layer keyed by
  // activeKey mounts in this very commit. An effect would resolve one render
  // late and land on a transition that has already started.
  const revealRef = useRef<{ key: string; enabled: boolean }>({ key: activeKey, enabled: false })
  if (revealRef.current.key !== activeKey) {
    // A push received while blanked lands as a cut: nothing is on screen to
    // animate from, and unblanking later cannot animate retroactively.
    revealRef.current = { key: activeKey, enabled: Boolean(pushOkRef.current) && !blanked }
  }

  const { incoming, outgoing, phase, markReady, incomingRef } = useContentTransition({
    content: activeContent,
    contentKey: activeKey,
    enabled: revealRef.current.enabled,
  })
  const staged = phase !== "idle"

  // Idle has no renderer to report its first paint; without this, going idle
  // would sit out the full ready timeout before moving.
  const incomingIsIdle = incoming.content.type === "idle"
  useEffect(() => {
    if (incomingIsIdle) markReady(incoming.key)
  }, [incomingIsIdle, incoming.key, markReady])

  const renderLayer = (layer: ContentLayer, role: { staged?: boolean; outgoing?: boolean }) =>
    layer.content.type === "idle" ? (
      <IdleDisplay name={name} />
    ) : (
      <ContentRenderer
        content={layer.content}
        preview={preview}
        staged={role.staged}
        outgoing={role.outgoing}
        // An outgoing layer must never advance the transition.
        onReady={role.outgoing ? undefined : () => markReady(layer.key)}
      />
    )

  // ONE keyed array, not two JSX slots: React carries a subtree across by key
  // only within a single array. As two slots, the outgoing layer would unmount
  // and remount — the video leaving the screen would restart and re-download.
  const layers: { layer: ContentLayer; outgoing: boolean }[] = []
  if (outgoing) layers.push({ layer: outgoing, outgoing: true })
  layers.push({ layer: incoming, outgoing: false })

  return (
    <div className={cn(contained ? "absolute" : "fixed", "inset-0 overflow-hidden bg-black")} data-player-phase={phase}>
      {layers.map(({ layer, outgoing: isOutgoing }) => (
        <div
          key={layer.key}
          ref={isOutgoing ? undefined : incomingRef}
          data-layer={isOutgoing ? "out" : "in"}
          data-content-id={layer.content.id}
          className={cn(
            "screen-layer",
            isOutgoing ? "screen-layer--out" : staged && "screen-layer--in",
            phase === "running" && "screen-layer--running"
          )}
        >
          {/* Blanking unmounts the content: a hidden-but-mounted <video> keeps
              playing its sound underneath a black overlay. */}
          {!blanked && renderLayer(layer, isOutgoing ? { outgoing: true } : { staged })}
        </div>
      ))}
      {blanked && <div className="absolute inset-0 z-50 bg-black" data-testid="blanked" />}
    </div>
  )
}
