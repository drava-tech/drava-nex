import { useEffect, useRef } from "react"
import { MonitorPlayIcon } from "lucide-react"
import type { ScreenContent } from "@workspace/types"

/**
 * Every renderer honours one contract with the transition:
 *
 *  - `staged`   mounted but parked below the screen. Must not start anything a
 *               viewer would see or hear begin — playback, sound.
 *  - `outgoing` sliding away and about to unmount. Must stop, and react to
 *               nothing.
 *  - `onReady`  called once the first frame can paint, AND on failure, so a
 *               broken item still lets the push complete instead of freezing
 *               the previous one on screen.
 */
export type RendererProps = {
  content: ScreenContent
  staged?: boolean | undefined
  outgoing?: boolean | undefined
  onReady?: (() => void) | undefined
  /** Console preview: always silent. */
  preview?: boolean | undefined
}

const fill = "fixed inset-0 h-svh w-svw bg-black"

export function ImageRenderer({ content, onReady }: RendererProps) {
  return (
    <img
      key={content.source}
      src={content.source}
      alt=""
      decoding="async"
      onLoad={onReady}
      onError={onReady}
      className={`${fill} object-contain`}
    />
  )
}

/** Window event other parts of the player use to mute or unmute the video. */
export const MUTE_EVENT = "push:mute"

export function VideoRenderer({ content, staged, outgoing, onReady, preview }: RendererProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const readyRef = useRef(false)
  const startedRef = useRef(false)
  const stagedRef = useRef(Boolean(staged))
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  /**
   * play() explicitly rather than the autoplay attribute: a browser that blocks
   * unmuted autoplay leaves an autoplay element frozen on its first frame with
   * no error anywhere. A rejected play() can be caught and retried muted.
   */
  const start = () => {
    const video = ref.current
    if (!video || startedRef.current || !readyRef.current || stagedRef.current) return
    startedRef.current = true
    video.play().catch(() => {
      if (!video.muted) {
        video.muted = true
        void video.play().catch(() => {})
      }
    })
  }
  const startRef = useRef(start)
  startRef.current = start

  // Deferred while staged; starts the moment the layer is released.
  useEffect(() => {
    stagedRef.current = Boolean(staged)
    if (!staged) startRef.current()
  }, [staged])

  // Outgoing: stop now. Frees the decoder and silences it while it slides away.
  useEffect(() => {
    if (outgoing) ref.current?.pause()
  }, [outgoing])

  useEffect(() => {
    if (preview || outgoing) return
    const onMute = (e: Event) => {
      if (ref.current) ref.current.muted = (e as CustomEvent<{ muted: boolean }>).detail.muted
    }
    window.addEventListener(MUTE_EVENT, onMute)
    return () => window.removeEventListener(MUTE_EVENT, onMute)
  }, [preview, outgoing])

  const markReady = () => {
    if (readyRef.current) return
    readyRef.current = true
    onReadyRef.current?.()
    startRef.current()
  }

  return (
    <video
      ref={ref}
      key={content.source}
      src={content.source}
      className={`${fill} object-contain`}
      playsInline
      preload="auto"
      muted={preview || content.muted}
      loop={content.loop}
      // First decoded frame: the moment the push may start moving.
      onLoadedData={markReady}
      onError={markReady}
    />
  )
}

/**
 * A full-screen page: a pasted link, or a document viewer route. Sandboxed —
 * scripts run, but the page cannot navigate the display away.
 */
export function HtmlRenderer({ content, onReady, preview }: RendererProps) {
  return (
    <iframe
      key={content.source}
      src={content.source}
      title={content.title ?? "Content"}
      onLoad={onReady}
      onError={onReady}
      className={`${fill} border-0 bg-white`}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
      allow={preview ? "encrypted-media; fullscreen" : "autoplay; encrypted-media; fullscreen"}
      referrerPolicy="no-referrer"
    />
  )
}

export function IdleDisplay({ name }: { name?: string | undefined }) {
  return (
    <div className={`${fill} flex flex-col items-center justify-center gap-6`} data-testid="idle">
      <div className="flex size-24 items-center justify-center rounded-3xl bg-white/5">
        <MonitorPlayIcon className="size-12 text-white/30" strokeWidth={1.25} />
      </div>
      {name && <p className="text-xs font-bold tracking-[0.3em] text-white/20 uppercase">{name}</p>}
    </div>
  )
}

export function ContentRenderer(props: RendererProps) {
  switch (props.content.type) {
    case "image":
      return <ImageRenderer {...props} />
    case "video":
      return <VideoRenderer {...props} />
    case "html":
      return <HtmlRenderer {...props} />
    case "idle":
      return null // chosen one level up; see ScreenPlayer
  }
}
