"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Centered, resolveSource } from "../../_components/viewer-common";
import { connectFrameBridge, type FrameBridge } from "@/lib/display/frame-bridge";

/** Minimal shape of the pdf.js pieces this viewer drives. */
interface PdfPageProxy {
  getViewport(params: { scale: number }): { width: number; height: number };
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void>; cancel(): void };
  cleanup(): void;
}
interface PdfDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
  destroy(): Promise<void>;
}

/**
 * Absolute view state. Offsets are NORMALIZED fractions of the rendered page,
 * never pixels: the TV and the CMS mirror render at different sizes, so pixel
 * offsets would desync them, and a remembered view would break on a
 * resolution change. `src` travels with the value and is checked on apply,
 * because the parent's replay buffer is keyed by command name rather than by
 * content — a leftover view from a previously-shown PDF must not be applied
 * to this one.
 */
interface PdfView {
  src: string;
  page: number;
  zoom: number;
  ox: number;
  oy: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_FACTOR = 1.1;
/** Matches SlidesViewer's resize debounce — a re-render is the expensive part. */
const RENDER_DEBOUNCE_MS = 200;
const EMIT_THROTTLE_MS = 200;
/** Beyond 2 the extra pixels are invisible but the canvas cost is not. */
const MAX_DPR = 2;
/** ~8.4M px. Zoom 4 on a 4K screen at dpr 2 would otherwise ask for a canvas
 * no embedded player can allocate. */
const MAX_CANVAS_PIXELS = 2 ** 23;
const CONTROLS_IDLE_MS = 3000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How far the page may be panned before its edge would pull into view. */
function panBounds(zoom: number, containerW: number, containerH: number, pageW: number, pageH: number) {
  const renderedW = containerW * zoom;
  const renderedH = (renderedW / pageW) * pageH;
  return {
    maxX: renderedW > containerW ? 1 - containerW / renderedW : 0,
    maxY: renderedH > containerH ? 1 - containerH / renderedH : 0,
    renderedW,
    renderedH,
  };
}

export function PdfViewer() {
  const params = useSearchParams();
  const src = params.get("src");

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PdfDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel(): void } | null>(null);
  const pageSizeRef = useRef({ w: 1, h: 1 });
  const bridgeRef = useRef<FrameBridge | null>(null);
  /** False on the CMS mirror. Only the authoritative instance answers a delta
   * command with an absolute SET_PDF_VIEW, or one remote zoom gets answered twice. */
  const authoritativeRef = useRef(true);
  const lastEmitRef = useRef(0);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingViewRef = useRef<PdfView | null>(null);

  const [numPages, setNumPages] = useState(0);
  /** Intrinsic page size. Mirrored into a ref for synchronous reads inside
   * event handlers, but held in state too so the canvas box re-lays-out
   * once the first page reveals the real aspect ratio. */
  const [pageSize, setPageSize] = useState({ w: 1, h: 1 });
  const [view, setView] = useState<PdfView>({ src: src ?? "", page: 1, zoom: 1, ox: 0, oy: 0 });
  /** Backing-store zoom — trails `view.zoom` by the debounce, so a gesture is
   * instant (CSS) and only the settled state pays for a re-render. */
  const [renderedZoom, setRenderedZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(false);

  const viewRef = useRef(view);
  viewRef.current = view;

  // ─── Emitting our position ────────────────────────────────────────────────

  /** Throttled with a guaranteed trailing emit — a wheel-pan would otherwise
   * flood the socket and thrash the gateway's LRU cache. Always sends the
   * newest value: `viewRef` still holds the previous one at this point,
   * because React has not re-rendered yet. */
  const emitView = useCallback((next: PdfView) => {
    if (!authoritativeRef.current) return;
    pendingViewRef.current = next;

    const flush = () => {
      emitTimerRef.current = null;
      const pending = pendingViewRef.current;
      if (!pending) return;
      pendingViewRef.current = null;
      lastEmitRef.current = Date.now();
      bridgeRef.current?.send("SET_PDF_VIEW", pending);
    };

    if (emitTimerRef.current) return; // already scheduled; it'll pick up the newest
    const since = Date.now() - lastEmitRef.current;
    if (since >= EMIT_THROTTLE_MS) flush();
    else emitTimerRef.current = setTimeout(flush, EMIT_THROTTLE_MS - since);
  }, []);

  const applyView = useCallback((updater: (prev: PdfView) => PdfView, emit = true) => {
    setView((prev) => {
      const next = updater(prev);
      if (next.page === prev.page && next.zoom === prev.zoom && next.ox === prev.ox && next.oy === prev.oy) {
        return prev;
      }
      if (emit) emitView(next);
      return next;
    });
  }, [emitView]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
  }, []);

  // ─── Load ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const source = resolveSource(src);
    if (!source) {
      setError("No PDF specified");
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Imported lazily so pdf.js never lands in the shared bundle — this
        // route is the only thing that needs it. The `legacy` build is
        // transpiled for older engines, which is what lets an embedded
        // signage browser run it at all.
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        // Served from public/ rather than resolved by the bundler, so dev
        // (Turbopack), build (webpack) and the Docker standalone output all
        // behave identically. Lives under /display/ deliberately: nginx's
        // plain-HTTP block 301s anything unmatched to HTTPS, which the TVs
        // can't complete — /display is already a routed prefix there.
        // Version-locked to the pinned pdfjs-dist in package.json; pdf.js
        // hard-throws if the API and worker versions differ.
        pdfjs.GlobalWorkerOptions.workerSrc = "/display/pdfjs/pdf.worker.min.mjs";

        const doc = (await pdfjs.getDocument({
          url: source,
          standardFontDataUrl: "/display/pdfjs/standard_fonts/",
          // /media/* is range-aware, so a long document streams the pages it
          // shows instead of downloading whole.
          disableAutoFetch: true,
          isEvalSupported: false,
        }).promise) as unknown as PdfDocumentProxy;

        if (cancelled) {
          void doc.destroy();
          return;
        }
        pdfRef.current = doc;
        setNumPages(doc.numPages);
        setView({ src: source, page: 1, zoom: 1, ox: 0, oy: 0 });
        setRenderedZoom(1);
      } catch (err) {
        if (cancelled) return;
        const e = err as { name?: string; status?: number; message?: string };
        if (e?.name === "PasswordException") setError("This PDF is password protected");
        else if (typeof e?.status === "number" && e.status > 0) setError(`Could not load the file (HTTP ${e.status})`);
        else setError("Could not read this PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
      emitTimerRef.current = null;
      void pdfRef.current?.destroy();
      pdfRef.current = null;
    };
  }, [src]);

  // ─── Render the current page at the settled zoom ──────────────────────────

  const renderPage = useCallback(async () => {
    const doc = pdfRef.current;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!doc || !container || !canvas) return;

    const containerW = container.clientWidth;
    if (containerW === 0) return;

    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;

    try {
      const page = await doc.getPage(viewRef.current.page);
      const base = page.getViewport({ scale: 1 });
      pageSizeRef.current = { w: base.width, h: base.height };
      setPageSize((prev) =>
        prev.w === base.width && prev.h === base.height ? prev : { w: base.width, h: base.height }
      );

      // Fit to width, then scale up by the settled zoom, capped so a large
      // page at high zoom degrades to a softer render rather than failing to
      // allocate.
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      let scale = (containerW / base.width) * renderedZoom * dpr;
      const px = base.width * scale * base.height * scale;
      if (px > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / px);

      const viewport = page.getViewport({ scale });

      // Render into a detached canvas and blit it, so assigning width/height
      // (which implicitly clears) never shows as a flash of blank page.
      const off = document.createElement("canvas");
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      const offCtx = off.getContext("2d");
      if (!offCtx) return;

      const task = page.render({ canvasContext: offCtx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;

      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext("2d")?.drawImage(off, 0, 0);
      page.cleanup();
    } catch (err) {
      // A cancelled render is the normal result of zooming or paging quickly.
      if ((err as { name?: string })?.name === "RenderingCancelledException") return;
      setError("Could not read this PDF");
    }
  }, [renderedZoom]);

  useEffect(() => {
    if (loading || error) return;
    void renderPage();
  }, [renderPage, view.page, loading, error]);

  // Settle zoom into the backing store after the gesture stops.
  useEffect(() => {
    if (view.zoom === renderedZoom) return;
    const timer = setTimeout(() => setRenderedZoom(view.zoom), RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [view.zoom, renderedZoom]);

  // Re-render on resize. Cheap relative to load: the parsed document is held
  // in a ref, so nothing is re-downloaded or re-parsed.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void renderPage(), RENDER_DEBOUNCE_MS);
    });
    observer.observe(container);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [renderPage]);

  // ─── Navigation, zoom, pan ────────────────────────────────────────────────

  const goToPage = useCallback((page: number, emit = true) => {
    const total = pdfRef.current?.numPages ?? 0;
    if (total === 0) return;
    // Clamp rather than wrap: a document has an end, unlike a looping deck.
    const next = clamp(page, 1, total);
    revealControls();
    // Offsets reset on a page change, but zoom is kept — zooming back out on
    // every page turn is not how a reader behaves.
    applyView((prev) => ({ ...prev, page: next, ox: 0, oy: 0 }), emit);
  }, [applyView, revealControls]);

  const zoomBy = useCallback((factor: number, emit = true) => {
    revealControls();
    applyView((prev) => {
      const zoom = clamp(prev.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const container = containerRef.current;
      if (!container) return { ...prev, zoom };
      const { w, h } = pageSizeRef.current;
      const b = panBounds(zoom, container.clientWidth, container.clientHeight, w, h);
      // Keep the viewport centre fixed while zooming.
      const centreX = prev.ox + (1 / prev.zoom) * 0.5;
      const centreY = prev.oy + (1 / prev.zoom) * 0.5;
      return {
        ...prev,
        zoom,
        ox: clamp(centreX - (1 / zoom) * 0.5, 0, b.maxX),
        oy: clamp(centreY - (1 / zoom) * 0.5, 0, b.maxY),
      };
    }, emit);
  }, [applyView, revealControls]);

  const panBy = useCallback((dx: number, dy: number, emit = true) => {
    revealControls();
    applyView((prev) => {
      const container = containerRef.current;
      if (!container) return prev;
      const { w, h } = pageSizeRef.current;
      const b = panBounds(prev.zoom, container.clientWidth, container.clientHeight, w, h);
      return { ...prev, ox: clamp(prev.ox + dx, 0, b.maxX), oy: clamp(prev.oy + dy, 0, b.maxY) };
    }, emit);
  }, [applyView, revealControls]);

  // Wheel: ctrl zooms, plain scrolls/pans. Deliberately NOT gated on zoom > 1
  // the way SlidesViewer is — at fit-width a portrait page is taller than the
  // screen, so vertical travel exists at zoom 1 and is exactly what the
  // touchpad's scroll strip drives. `{ passive: false }` so preventDefault
  // actually suppresses WebView2's own page zoom.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const container = containerRef.current;
      if (!container) return;

      if (e.ctrlKey) {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR);
        return;
      }
      if (e.deltaX === 0 && e.deltaY === 0) return;

      const { w, h } = pageSizeRef.current;
      const b = panBounds(viewRef.current.zoom, container.clientWidth, container.clientHeight, w, h);
      if (b.maxX === 0 && b.maxY === 0) return;
      e.preventDefault();
      panBy(e.deltaX / b.renderedW, e.deltaY / b.renderedH);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [zoomBy, panBy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") goToPage(viewRef.current.page + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") goToPage(viewRef.current.page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToPage]);

  // ─── Remote commands ──────────────────────────────────────────────────────

  useEffect(() => {
    const bridge = connectFrameBridge({
      onInit: ({ preview }) => {
        authoritativeRef.current = !preview;
      },
      onCommand: (command, value) => {
        if (command === "NEXT_PAGE") goToPage(viewRef.current.page + 1);
        else if (command === "PREV_PAGE") goToPage(viewRef.current.page - 1);
        else if (command === "PDF_ZOOM") {
          const dir = (value as { direction?: string } | undefined)?.direction;
          zoomBy(dir === "out" ? 1 / ZOOM_FACTOR : ZOOM_FACTOR);
        } else if (command === "PDF_PAN") {
          const v = (value as { dx?: number; dy?: number } | undefined) ?? {};
          panBy(v.dx ?? 0, v.dy ?? 0);
        } else if (command === "SET_PDF_VIEW") {
          const v = value as PdfView | undefined;
          if (!v || typeof v.page !== "number") return;
          // Guard against a leftover view for a different document — the
          // parent's replay buffer is keyed by command, not by content.
          const source = resolveSource(src);
          if (v.src && source && v.src !== source) return;
          // emit: false — this IS the echo of our own state, or another
          // client's; re-emitting it would loop.
          applyView((prev) => ({ ...prev, page: v.page, zoom: v.zoom, ox: v.ox, oy: v.oy }), false);
        }
      },
    });
    bridgeRef.current = bridge;
    return () => {
      bridge.disconnect();
      bridgeRef.current = null;
    };
  }, [goToPage, zoomBy, panBy, applyView, src]);

  // ─── Auto-hiding chrome ───────────────────────────────────────────────────

  useEffect(() => {
    if (!controlsVisible) return;
    const timer = setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS);
    return () => clearTimeout(timer);
  }, [controlsVisible, view]);

  useEffect(() => {
    const onPointer = () => revealControls();
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [revealControls]);

  const showControls = numPages > 1 && !loading && !error;
  const { renderedW, renderedH } = panBounds(
    view.zoom,
    containerRef.current?.clientWidth ?? 0,
    containerRef.current?.clientHeight ?? 0,
    pageSize.w,
    pageSize.h
  );

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] text-zinc-100">
      {/* Static clip boundary pinned to the viewport, with the page transformed
          inside it — so zooming never spills past the screen and the display
          page's own overflow lockdown can stay fully on. */}
      <div ref={containerRef} className="absolute inset-0 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: renderedW ? `${renderedW}px` : "100%",
            height: renderedH ? `${renderedH}px` : "auto",
            transform: `translate3d(${-view.ox * renderedW}px, ${-view.oy * renderedH}px, 0)`,
          }}
        />
      </div>

      {loading && <Centered>Loading PDF…</Centered>}
      {error && <Centered tone="error">{error}</Centered>}
      {!loading && !error && numPages === 0 && <Centered>This PDF has no pages</Centered>}

      {showControls && (
        <div
          className={`absolute bottom-4 left-4 flex items-center gap-3 rounded-full border border-white/10 bg-black/60 px-3 py-2 backdrop-blur-sm transition-opacity duration-300 ${
            controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <button
            onClick={() => goToPage(view.page - 1)}
            aria-label="Previous page"
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-[4.5rem] text-center text-sm tabular-nums text-zinc-400">
            {view.page} / {numPages}
          </span>
          <button
            onClick={() => goToPage(view.page + 1)}
            aria-label="Next page"
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
