import { useEffect, useRef, useState } from "react"
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

import { PagerOverlay, useDocument, usePager, useViewportSize, ViewerStatus } from "./shared"

/** Beyond 2 the extra pixels are invisible but the canvas cost is not. */
const MAX_DPR = 2
/** ~8.4 MP. Larger canvases fail to allocate on embedded players. */
const MAX_CANVAS_PIXELS = 2 ** 23

async function loadPdf(res: Response): Promise<PDFDocumentProxy> {
  const pdfjs = await import("pdfjs-dist")
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise
}

/** One page at a time, fitted to the screen. */
export function PdfViewer() {
  const doc = useDocument(loadPdf)
  const pdf = doc.status === "ready" ? doc.data : null
  const pager = usePager(pdf?.numPages ?? 0)
  const size = useViewportSize()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => () => void pdf?.destroy(), [pdf])

  useEffect(() => {
    if (!pdf || !canvasRef.current) return
    let task: RenderTask | null = null
    let cancelled = false
    ;(async () => {
      const page = await pdf.getPage(pager.index + 1)
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      // Fit the whole page on screen (contain), then sharpen for the display's
      // pixel density — capped, so a 4K panel never asks for a huge canvas.
      const fit = Math.min(size.w / base.width, size.h / base.height)
      let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      const pixels = base.width * fit * dpr * base.height * fit * dpr
      if (pixels > MAX_CANVAS_PIXELS) dpr *= Math.sqrt(MAX_CANVAS_PIXELS / pixels)
      const viewport = page.getViewport({ scale: fit * dpr })

      const canvas = canvasRef.current!
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
      task = page.render({ canvasContext: canvas.getContext("2d")!, viewport })
      await task.promise
      page.cleanup()
    })().catch((err: unknown) => {
      if (cancelled || (err as { name?: string }).name === "RenderingCancelledException") return
      setRenderError("This page could not be drawn.")
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, pager.index, size])

  if (doc.status !== "ready") return <ViewerStatus state={doc} />
  if (renderError) return <ViewerStatus state={{ status: "error", message: renderError }} />

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a0a]" data-testid="pdf-viewer" data-page={pager.index + 1}>
      <canvas ref={canvasRef} className="bg-white shadow-2xl" />
      <PagerOverlay {...pager} />
    </div>
  )
}
