"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
 * Absolute view state. Offsets are NORMALIZED fractions, never pixels: the TV
 * and the CMS mirror render at different sizes, so pixel offsets would desync
 * them, and a remembered view would break on a resolution change. `src`
 * travels with the value and is checked on apply, because the parent's replay
 * buffer is keyed by command name rather than by content — a leftover view
 * from a previously-shown PDF must not be applied to this one.
 *
 * This viewer scrolls continuously rather than paging, so:
 *   page — the page currently at the TOP of the viewport
 *   oy   — how far INTO that page the viewport has scrolled (0..1)
 *
 * The gateway caches and replays SET_PDF_VIEW verbatim (see viewStateCache in
 * apps/api/src/ws/gateway.ts) without ever reading inside the value, so a
 * position remembered under an older shape still restores correctly here —
 * any extra keys it carries are simply never read.
 */
interface PdfView {
  src: string;
  page: number;
  oy: number;
}

const EMIT_THROTTLE_MS = 200;
/** Beyond 2 the extra pixels are invisible but the canvas cost is not. */
const MAX_DPR = 2;
/** ~8.4M px. A tall page fit to a 4K screen at dpr 2 would otherwise ask for
 * a canvas no embedded player can allocate. */
const MAX_CANVAS_PIXELS = 2 ** 23;
const CONTROLS_IDLE_MS = 3000;
/** Gutter between pages, in CSS px — the visual cue that says "new page". */
const PAGE_GAP = 12;
/** Pages kept rendered beyond the viewport on each side. One is enough to
 * cover a fast fling without holding a whole document's canvases in memory. */
const OVERSCAN = 1;
/** A programmatic scroll fires `scroll` asynchronously; ignore our own echo
 * for this long so restoring a position doesn't re-emit it. */
const SCROLL_ECHO_MS = 200;
/** A "page down" keeps a sliver of the previous screen for continuity. */
const VIEWPORT_STEP = 0.92;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface PageSize {
  w: number;
  h: number;
}

/** Where every page sits in the scrolling column. */
interface Layout {
  tops: number[];
  heights: number[];
  total: number;
}

const EMPTY_LAYOUT: Layout = { tops: [], heights: [], total: 0 };

/** Index of the page containing `offset`, by binary search over page tops. */
function pageIndexAt(layout: Layout, offset: number): number {
  if (layout.tops.length === 0) return 0;
  let lo = 0;
  let hi = layout.tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((layout.tops[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function PdfViewer() {
  const params = useSearchParams();
  const src = params.get("src");

  const scrollRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfDocumentProxy | null>(null);
  const bridgeRef = useRef<FrameBridge | null>(null);
  /** False on the CMS mirror. Only the authoritative instance answers a delta
   * command with an absolute SET_PDF_VIEW, or one remote step gets answered twice. */
  const authoritativeRef = useRef(true);
  const lastEmitRef = useRef(0);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingViewRef = useRef<PdfView | null>(null);
  /** The most recent inbound SET_PDF_VIEW, kept even while the document is
   * still downloading — the postMessage that carries it lands long before
   * pdf.js finishes fetching and parsing, so without this the load would have
   * nothing left to restore from. */
  const pendingRestoreRef = useRef<PdfView | null>(null);
  /** Set while we move the scroll position ourselves, so the resulting
   * `scroll` event isn't mistaken for the user and echoed back out. */
  const suppressUntilRef = useRef(0);

  const [numPages, setNumPages] = useState(0);
  /** Intrinsic size per page. Seeded from page 1 for the whole document and
   * corrected per page as each one actually renders — asking pdf.js for all N
   * pages up front would turn `disableAutoFetch` into N network round-trips,
   * and virtually every real document is uniformly sized anyway. */
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<PdfView>({ src: src ?? "", page: 1, oy: 0 });
  /** A view the scroll container must be moved to once layout allows it —
   * a restore, or a resize re-anchor. */
  const [pendingScroll, setPendingScroll] = useState<PdfView | null>(null);
  const [range, setRange] = useState({ start: 0, end: -1 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(false);

  const viewRef = useRef(view);
  viewRef.current = view;

  // ─── Layout ───────────────────────────────────────────────────────────────

  const layout = useMemo<Layout>(() => {
    if (pageSizes.length === 0 || containerSize.w === 0) return EMPTY_LAYOUT;
    // Always fit-to-width — the column is exactly the container, which is what
    // pins scrollLeft at 0 and keeps this a purely vertical scroll.
    const tops: number[] = [];
    const heights: number[] = [];
    let y = 0;
    for (const size of pageSizes) {
      const h = size.w > 0 ? (containerSize.w / size.w) * size.h : 0;
      tops.push(y);
      heights.push(h);
      y += h + PAGE_GAP;
    }
    return { tops, heights, total: Math.max(0, y - PAGE_GAP) };
  }, [pageSizes, containerSize.w]);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // ─── Emitting our position ────────────────────────────────────────────────

  /** Throttled with a guaranteed trailing emit — a scroll would otherwise
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
      if (next.page === prev.page && next.oy === prev.oy) {
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
      setPageSizes([]);
      setRange({ start: 0, end: -1 });
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

        if (doc.numPages === 0) {
          pdfRef.current = doc;
          setNumPages(0);
          return;
        }

        // Page 1's size seeds the whole column so the scrollbar has a sane
        // extent before anything has rendered.
        const first = await doc.getPage(1);
        const base = first.getViewport({ scale: 1 });
        first.cleanup();
        if (cancelled) {
          void doc.destroy();
          return;
        }

        pdfRef.current = doc;
        setNumPages(doc.numPages);
        setPageSizes(Array.from({ length: doc.numPages }, () => ({ w: base.width, h: base.height })));

        // Resume where this document was left off, if the gateway replayed a
        // position for it while we were still loading. Anything else — a
        // first-ever view, or a stale position belonging to a different file —
        // starts at the top.
        const restore = pendingRestoreRef.current;
        const initial: PdfView =
          restore && restore.src === source
            ? { src: source, page: clamp(restore.page, 1, doc.numPages), oy: restore.oy }
            : { src: source, page: 1, oy: 0 };
        setView(initial);
        setPendingScroll(initial);
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
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
      emitTimerRef.current = null;
      void pdfRef.current?.destroy();
      pdfRef.current = null;
    };
  }, [src]);

  // ─── Scroll position ⇄ view state ─────────────────────────────────────────

  /** Which pages to keep rendered. Cheap enough to run on every scroll: it
   * binary-searches to the first visible page and walks forward from there,
   * so cost is proportional to what's on screen, not to the document. */
  const updateRange = useCallback(() => {
    const el = scrollRef.current;
    const l = layoutRef.current;
    if (!el || l.tops.length === 0) return;
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    const first = pageIndexAt(l, top);
    let last = first;
    while (last + 1 < l.tops.length && (l.tops[last + 1] ?? 0) <= bottom) last++;
    const start = Math.max(0, first - OVERSCAN);
    const end = Math.min(l.tops.length - 1, last + OVERSCAN);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateRange();
    revealControls();
    // Our own programmatic scroll — applying it again would be a no-op, but
    // emitting it would echo a restore straight back to the gateway.
    if (Date.now() < suppressUntilRef.current) return;

    const l = layoutRef.current;
    if (l.tops.length === 0) return;
    const i = pageIndexAt(l, el.scrollTop);
    const height = l.heights[i] || 1;
    const oy = clamp((el.scrollTop - (l.tops[i] ?? 0)) / height, 0, 1);
    applyView((prev) => ({ ...prev, page: i + 1, oy }));
  }, [applyView, revealControls, updateRange]);

  // Move the container to a requested view, once there's a layout to resolve
  // it against. Deferred through state rather than done inline because a
  // restore can arrive before the document has loaded, and a resize re-anchor
  // has to wait for the new layout to be computed.
  useEffect(() => {
    if (!pendingScroll) return;
    const el = scrollRef.current;
    if (!el || layout.tops.length === 0) return;

    const i = clamp(pendingScroll.page, 1, layout.tops.length) - 1;
    const top = (layout.tops[i] ?? 0) + pendingScroll.oy * (layout.heights[i] ?? 0);

    suppressUntilRef.current = Date.now() + SCROLL_ECHO_MS;
    el.scrollTo({ top });
    setPendingScroll(null);
    updateRange();
  }, [pendingScroll, layout, updateRange]);

  // Keep the window in step with a layout change that didn't come from a
  // scroll (first render, a page correcting its own height).
  useEffect(() => {
    updateRange();
  }, [layout, updateRange]);

  // ─── Sizing ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setContainerSize((prev) => {
        if (prev.w === w && prev.h === h) return prev;
        // The column is about to be re-laid-out at a new width, which would
        // leave the raw scrollTop pointing somewhere else entirely — re-anchor
        // on the page we were actually reading.
        if (prev.w !== 0) setPendingScroll(viewRef.current);
        return { w, h };
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  /** A page reporting the size it really is, once rendered. */
  const handleMeasured = useCallback((pageNumber: number, w: number, h: number) => {
    setPageSizes((prev) => {
      const i = pageNumber - 1;
      const current = prev[i];
      if (!current || (current.w === w && current.h === h)) return prev;
      const next = prev.slice();
      next[i] = { w, h };
      return next;
    });
  }, []);

  // ─── Stepping ─────────────────────────────────────────────────────────────

  /** One screenful, the way PageDown behaves in any reader — there are no
   * page buttons in a continuously scrolling viewer to snap to instead. */
  const stepViewport = useCallback((direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    revealControls();
    el.scrollBy({ top: direction * el.clientHeight * VIEWPORT_STEP, behavior: "smooth" });
  }, [revealControls]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") stepViewport(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") stepViewport(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepViewport]);

  // ─── Remote commands ──────────────────────────────────────────────────────

  useEffect(() => {
    const bridge = connectFrameBridge({
      onInit: ({ preview }) => {
        authoritativeRef.current = !preview;
      },
      onCommand: (command, value) => {
        if (command === "NEXT_PAGE") stepViewport(1);
        else if (command === "PREV_PAGE") stepViewport(-1);
        else if (command === "SET_PDF_VIEW") {
          const v = value as PdfView | undefined;
          if (!v || typeof v.page !== "number") return;
          // Guard against a leftover view for a different document — the
          // parent's replay buffer is keyed by command, not by content.
          const source = resolveSource(src);
          if (v.src && source && v.src !== source) return;
          const next: PdfView = { ...v, src: v.src || source || "" };
          // Held for the load effect too: this may well arrive before pdf.js
          // has finished, in which case applying it now would be undone by
          // the fresh state the load sets up.
          pendingRestoreRef.current = next;
          setPendingScroll(next);
          // emit: false — this IS the echo of our own state, or another
          // client's; re-emitting it would loop.
          applyView(() => next, false);
        }
      },
    });
    bridgeRef.current = bridge;
    return () => {
      bridge.disconnect();
      bridgeRef.current = null;
    };
  }, [stepViewport, applyView, src]);

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

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] text-zinc-100">
      {/* Signage must never show a scrollbar. Hidden here rather than pushed
          off-screen by HtmlRenderer's width overhang, which would scale and
          then crop the content itself — see isExactFitViewer there. */}
      <style>{`.pdf-scroll::-webkit-scrollbar { display: none; }`}</style>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="pdf-scroll absolute inset-0 overflow-auto"
        style={{ scrollbarWidth: "none", overscrollBehavior: "none" }}
      >
        {/* The full column, sized up front from page 1 so the scroll extent is
            right before anything has rendered. Only the pages near the
            viewport actually exist in the DOM. */}
        <div
          style={{
            position: "relative",
            width: containerSize.w || "100%",
            height: layout.total,
          }}
        >
          {pageSizes.map((_, i) =>
            i >= range.start && i <= range.end ? (
              <PageSlot
                key={i}
                doc={pdfRef.current}
                pageNumber={i + 1}
                top={layout.tops[i] ?? 0}
                width={containerSize.w}
                height={layout.heights[i] ?? 0}
                renderWidth={containerSize.w}
                onMeasured={handleMeasured}
              />
            ) : null
          )}
        </div>
      </div>

      {loading && <Centered>Loading PDF…</Centered>}
      {error && <Centered tone="error">{error}</Centered>}
      {!loading && !error && numPages === 0 && <Centered>This PDF has no pages</Centered>}

      {showControls && (
        <div
          className={`pointer-events-none absolute bottom-4 left-4 rounded-full border border-white/10 bg-black/60 px-4 py-2 backdrop-blur-sm transition-opacity duration-300 ${
            controlsVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="text-sm tabular-nums text-zinc-400">
            {view.page} / {numPages}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * One page of the column. Mounted only while it is near the viewport, so its
 * canvas — the expensive part — is allocated on approach and released on the
 * way out, which is what lets a several-hundred-page document scroll at all.
 */
function PageSlot({
  doc,
  pageNumber,
  top,
  width,
  height,
  renderWidth,
  onMeasured,
}: {
  doc: PdfDocumentProxy | null;
  pageNumber: number;
  top: number;
  width: number;
  height: number;
  /** Backing-store width in CSS px, before the device-pixel-ratio scale-up. */
  renderWidth: number;
  onMeasured: (pageNumber: number, w: number, h: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<{ cancel(): void } | null>(null);

  useEffect(() => {
    if (!doc || renderWidth <= 0) return;
    let cancelled = false;

    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) {
          page.cleanup();
          return;
        }
        const base = page.getViewport({ scale: 1 });
        onMeasured(pageNumber, base.width, base.height);

        // Fit to the column, capped so a very tall page degrades to a softer
        // render rather than failing to allocate.
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        let scale = (renderWidth / base.width) * dpr;
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
        taskRef.current = task;
        await task.promise;
        taskRef.current = null;
        if (cancelled) {
          page.cleanup();
          return;
        }

        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = off.width;
          canvas.height = off.height;
          canvas.getContext("2d")?.drawImage(off, 0, 0);
        }
        page.cleanup();
      } catch (err) {
        // A cancelled render is the normal result of scrolling quickly.
        // Anything else is left as a blank page rather than taken as
        // a reason to blank the whole document — one unreadable page in a long
        // PDF should not cost the reader the other 200.
        if ((err as { name?: string })?.name === "RenderingCancelledException") return;
      }
    })();

    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      taskRef.current = null;
    };
  }, [doc, pageNumber, renderWidth, onMeasured]);

  return (
    <div style={{ position: "absolute", top, left: 0, width, height, backgroundColor: "#fff" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
