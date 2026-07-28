"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** How long each slide holds when running unattended on a screen. */
const KIOSK_SLIDE_MS = 10_000;

/**
 * The bits of pptx-preview's previewer we drive. Its own typings are shipped
 * but the module is imported lazily, so this is what we pin the ref to.
 */
interface Previewer {
  readonly slideCount: number;
  currentIndex: number;
  preview: (file: ArrayBuffer) => Promise<unknown>;
  renderSingleSlide: (index: number) => void;
  destroy: () => void;
}

/** Only same-origin/relative sources are loadable — anything else fails CORS anyway. */
function resolveSource(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function SlidesViewer() {
  const params = useSearchParams();
  const src = params.get("src");
  const kiosk = params.get("kiosk") === "1";

  const hostRef = useRef<HTMLDivElement>(null);
  // The parsed file is kept so a resize can re-render without re-downloading.
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const previewerRef = useRef<Previewer | null>(null);

  const [slideCount, setSlideCount] = useState(0);
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Build (or rebuild) the previewer at the host's current pixel size. The
   * library lays out to a fixed viewport rather than a responsive one, so a
   * resize means tearing the render down and doing it again — hence the cached
   * buffer above. `destroy()` only clears the library's internal registries, it
   * doesn't detach its wrapper, so the host is emptied by hand.
   */
  const render = useCallback(async (buffer: ArrayBuffer, startIndex: number) => {
    const host = hostRef.current;
    if (!host) return;

    previewerRef.current?.destroy();
    host.innerHTML = "";

    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === 0 || height === 0) return;

    // Imported lazily so the pptx parser (and its echarts/jszip dependencies)
    // never lands in the shared bundle — this route is the only thing needing it.
    const { init } = await import("pptx-preview");

    // The renderer scales content by viewPort.width / deck width and centres
    // the result vertically, so handing it the host box letterboxes any aspect
    // ratio correctly — no need to know the deck's own dimensions up front.
    const previewer = init(host, { width, height, mode: "slide" }) as unknown as Previewer;
    previewerRef.current = previewer;

    await previewer.preview(buffer);

    const count = previewer.slideCount;
    setSlideCount(count);

    // A rebuild mid-deck should land back where the viewer already was.
    const index = count > 0 ? Math.min(startIndex, count - 1) : 0;
    if (index !== 0) previewer.renderSingleSlide(index);
    setCurrent(index);
  }, []);

  const goTo = useCallback((index: number) => {
    const previewer = previewerRef.current;
    if (!previewer || previewer.slideCount === 0) return;
    // Wrap in both directions, so a screen loops the deck forever.
    const count = previewer.slideCount;
    const next = ((index % count) + count) % count;
    previewer.renderSingleSlide(next);
    setCurrent(next);
  }, []);

  // Initial load.
  useEffect(() => {
    const source = resolveSource(src);
    if (!source) {
      setError("No presentation specified");
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status})`);
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        bufferRef.current = buffer;
        await render(buffer, 0);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not read this presentation");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      previewerRef.current?.destroy();
      previewerRef.current = null;
    };
  }, [src, render]);

  // Re-render on resize, debounced — each rebuild re-parses the deck.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const buffer = bufferRef.current;
        if (buffer) void render(buffer, previewerRef.current?.currentIndex ?? 0);
      }, 200);
    });
    observer.observe(host);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [render]);

  // Unattended playback on a screen.
  useEffect(() => {
    if (!kiosk || slideCount < 2) return;
    const timer = setInterval(() => goTo((previewerRef.current?.currentIndex ?? 0) + 1), KIOSK_SLIDE_MS);
    return () => clearInterval(timer);
  }, [kiosk, slideCount, goTo]);

  // Arrow-key navigation for the human-facing preview.
  useEffect(() => {
    if (kiosk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        goTo((previewerRef.current?.currentIndex ?? 0) + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        goTo((previewerRef.current?.currentIndex ?? 0) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kiosk, goTo]);

  const showControls = !kiosk && slideCount > 1 && !loading && !error;

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0a0a0a] text-zinc-100">
      {/*
        The library draws its own next/prev buttons and pagination in "slide"
        mode. They're hidden here in favour of the controls below, which match
        the rest of the display surfaces.
      */}
      <style>{`
        .pptx-preview-wrapper-next,
        .pptx-preview-wrapper-pre,
        .pptx-preview-wrapper-pagination { display: none !important; }
        .pptx-preview-wrapper { background: transparent !important; }
      `}</style>

      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />

      {loading && <Centered>Loading presentation…</Centered>}
      {error && <Centered tone="error">{error}</Centered>}
      {!loading && !error && slideCount === 0 && <Centered>This presentation has no slides</Centered>}

      {showControls && (
        <div className="flex shrink-0 items-center justify-center gap-4 border-t border-white/10 px-4 py-3">
          <button
            onClick={() => goTo(current - 1)}
            aria-label="Previous slide"
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-[4.5rem] text-center text-sm tabular-nums text-zinc-400">
            {current + 1} / {slideCount}
          </span>
          <button
            onClick={() => goTo(current + 1)}
            aria-label="Next slide"
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}

function Centered({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a0a] p-8 text-center">
      <p className={`text-lg ${tone === "error" ? "text-red-400" : "text-zinc-400"}`}>{children}</p>
    </div>
  );
}
