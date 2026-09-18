import { useEffect, useRef, useState } from "react"

import { patchFonts } from "./office-fonts"
import { PagerOverlay, useDocument, usePager, useViewportSize, ViewerStatus } from "./shared"

/** The parts of pptx-preview's previewer this viewer drives. */
interface Previewer {
  readonly slideCount: number
  preview: (file: ArrayBuffer) => Promise<unknown>
  renderSingleSlide: (index: number) => void
  destroy?: () => void
}

/** The deck is laid out once at this size and scaled to the screen with CSS. */
const BASE_W = 1920
const BASE_H = 1080

export function SlidesViewer() {
  const doc = useDocument((res) => res.arrayBuffer())
  const hostRef = useRef<HTMLDivElement>(null)
  const previewerRef = useRef<Previewer | null>(null)
  const [slideCount, setSlideCount] = useState(0)
  const [renderError, setRenderError] = useState<string | null>(null)
  const pager = usePager(slideCount)
  const size = useViewportSize()

  useEffect(() => {
    if (doc.status !== "ready" || !hostRef.current) return
    const host = hostRef.current
    let cancelled = false
    ;(async () => {
      // Lazy: the library (and echarts beneath it) loads only for decks.
      const { init } = await import("pptx-preview")
      if (cancelled) return
      host.innerHTML = ""
      const previewer = init(host, { width: BASE_W, height: BASE_H, mode: "slide" }) as unknown as Previewer
      previewerRef.current = previewer
      await previewer.preview(doc.data.slice(0))
      if (cancelled) return
      previewer.renderSingleSlide(0)
      patchFonts(host)
      setSlideCount(previewer.slideCount)
    })().catch(() => !cancelled && setRenderError("This presentation could not be opened."))
    return () => {
      cancelled = true
      previewerRef.current?.destroy?.()
      previewerRef.current = null
    }
  }, [doc])

  useEffect(() => {
    const previewer = previewerRef.current
    if (!previewer || slideCount === 0 || !hostRef.current) return
    previewer.renderSingleSlide(pager.index)
    patchFonts(hostRef.current)
  }, [pager.index, slideCount])

  if (doc.status !== "ready") return <ViewerStatus state={doc} />
  if (renderError) return <ViewerStatus state={{ status: "error", message: renderError }} />

  // Scale the fixed-size slide to fit (contain) — re-laying out the deck on
  // every resize would re-parse the whole file.
  const scale = Math.min(size.w / BASE_W, size.h / BASE_H)
  return (
    <div
      className="fixed inset-0 flex items-center justify-center overflow-hidden bg-[#0a0a0a]"
      data-testid="slides-viewer"
      data-slide={pager.index + 1}
      data-slides={slideCount}
    >
      <style>{`
        .pptx-preview-wrapper-next, .pptx-preview-wrapper-pre, .pptx-preview-wrapper-pagination { display: none !important; }
        .pptx-preview-wrapper { background: transparent !important; }
      `}</style>
      <div style={{ width: BASE_W, height: BASE_H, transform: `scale(${scale})`, flex: "none" }}>
        <div ref={hostRef} />
      </div>
      {slideCount === 0 && <ViewerStatus state={{ status: "loading" }} />}
      <PagerOverlay {...pager} />
    </div>
  )
}
