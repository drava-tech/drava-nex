"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Centered, resolveSource } from "../../_components/viewer-common";
import { connectFrameBridge, type FrameBridge } from "@/lib/display/frame-bridge";

// Metric-compatible, self-hosted replacements for the handful of Microsoft
// Office fonts that actually show up in decks (Google's own substitutes,
// same ones ChromeOS/LibreOffice use) — pptx-preview never embeds real font
// files, so without these, any of these named fonts just falls back to
// whatever generic sans/serif the viewing machine happens to have.
import "@fontsource/carlito/400.css";
import "@fontsource/carlito/700.css";
import "@fontsource/carlito/400-italic.css";
import "@fontsource/carlito/700-italic.css";
import "@fontsource/caladea/400.css";
import "@fontsource/caladea/700.css";
import "@fontsource/caladea/400-italic.css";
import "@fontsource/caladea/700-italic.css";
import "@fontsource/arimo/400.css";
import "@fontsource/arimo/700.css";
import "@fontsource/arimo/400-italic.css";
import "@fontsource/arimo/700-italic.css";
import "@fontsource/tinos/400.css";
import "@fontsource/tinos/700.css";
import "@fontsource/tinos/400-italic.css";
import "@fontsource/tinos/700-italic.css";
import "@fontsource/cousine/400.css";
import "@fontsource/cousine/700.css";
import "@fontsource/cousine/400-italic.css";
import "@fontsource/cousine/700-italic.css";
import "@fontsource/gelasio/400.css";
import "@fontsource/gelasio/700.css";
import "@fontsource/gelasio/400-italic.css";
import "@fontsource/gelasio/700-italic.css";

/** Recognized Office typeface name (lowercased) → bundled substitute stack. */
const FONT_SUBSTITUTES: Record<string, string> = {
  calibri: "Carlito, sans-serif",
  "calibri light": "Carlito, sans-serif",
  cambria: "Caladea, serif",
  arial: "Arimo, Arial, sans-serif",
  "times new roman": "Tinos, Times New Roman, serif",
  "courier new": "Cousine, Courier New, monospace",
  georgia: "Gelasio, Georgia, serif",
};

/**
 * pptx-preview sets font-family as an inline style on the elements it
 * generates (not a stylesheet rule it exposes), so overriding it means
 * walking the rendered DOM after each render/navigation rather than any CSS
 * specificity trick. Anything in `embeddedFamilies` is left untouched — the
 * deck's own real font was successfully extracted and registered for it (see
 * extractEmbeddedFonts below), which beats any substitute.
 */
function patchFonts(host: HTMLElement, embeddedFamilies: ReadonlySet<string>) {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as HTMLElement | null;
  while (node) {
    const family = node.style?.fontFamily;
    if (family) {
      const key = family.replace(/["']/g, "").trim().toLowerCase();
      if (!embeddedFamilies.has(key)) {
        const sub = FONT_SUBSTITUTES[key];
        if (sub) node.style.fontFamily = sub;
      }
    }
    node = walker.nextNode() as HTMLElement | null;
  }
}

/**
 * PowerPoint stores an embedded font (only present if the author enabled
 * "Embed fonts in the file") as EOT (Embedded OpenType) — a legacy IE
 * container wrapping a plain sfnt (TrueType/OpenType) blob. Two 32-bit
 * little-endian sizes at the very start of the struct — total size, then the
 * size of the font data occupying the END of the struct — say exactly where
 * the real font bytes are, no parsing of the rest of the (variable-length)
 * header needed. EOT can optionally carry an extra MTX (MicroType Express)
 * compression layer on top, which isn't decoded here — this is why the
 * result is validated to actually start with a real sfnt signature before
 * being trusted; anything else (MTX-compressed, corrupt, unrecognized)
 * returns null so the caller just falls back to the substitute font map.
 */
function unwrapEot(raw: Uint8Array): Uint8Array | null {
  if (raw.length < 8) return null;
  const header = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const fontDataSize = header.getUint32(4, true);
  if (fontDataSize <= 0 || fontDataSize > raw.length) return null;

  const fontData = raw.slice(raw.length - fontDataSize);
  if (fontData.length < 4) return null;
  const sfntVersion = new DataView(fontData.buffer, fontData.byteOffset, 4).getUint32(0, false);
  const isKnownSfnt =
    sfntVersion === 0x00010000 || // TrueType
    sfntVersion === 0x4f54544f || // 'OTTO' — CFF-based OpenType
    sfntVersion === 0x74727565 || // 'true'
    sfntVersion === 0x74746366; // 'ttcf' — TrueType collection
  return isKnownSfnt ? fontData : null;
}

/** Resolves a (possibly-relative, possibly with "../") OOXML relationship target against the part that referenced it. */
function resolveOoxmlPath(basePart: string, target: string): string {
  if (target.startsWith("/")) return target.replace(/^\//, "");
  const baseDir = basePart.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") baseDir.pop();
    else if (segment !== ".") baseDir.push(segment);
  }
  return baseDir.join("/");
}

interface EmbeddedFontSlot {
  typeface: string;
  weight: string;
  style: "normal" | "italic";
  zipPath: string;
}

/**
 * Finds any fonts the deck itself embeds (`<p:embeddedFontLst>` in
 * ppt/presentation.xml), extracts and registers each one that turns out to be
 * a plain (non-MTX-compressed) EOT via the FontFace API, and returns the set
 * of typeface names (lowercased) that are now genuinely available — the deck's
 * *actual* font, not a substitute. Safe to call on any .pptx: a deck with no
 * embedded fonts, a malformed file, or an unsupported (MTX) encoding all just
 * resolve to an empty set, leaving the substitute-font map as the only effect.
 */
async function extractEmbeddedFonts(buffer: ArrayBuffer): Promise<Set<string>> {
  const registered = new Set<string>();
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buffer);

    const presentationPart = zip.file("ppt/presentation.xml");
    const relsPart = zip.file("ppt/_rels/presentation.xml.rels");
    if (!presentationPart || !relsPart) return registered;

    const [presentationXml, relsXml] = await Promise.all([
      presentationPart.async("string"),
      relsPart.async("string"),
    ]);

    const parser = new DOMParser();
    const presDoc = parser.parseFromString(presentationXml, "application/xml");
    const relsDoc = parser.parseFromString(relsXml, "application/xml");

    const relTargets = new Map<string, string>();
    for (const rel of Array.from(relsDoc.getElementsByTagName("Relationship"))) {
      const id = rel.getAttribute("Id");
      const target = rel.getAttribute("Target");
      if (id && target) relTargets.set(id, target);
    }

    const slots: EmbeddedFontSlot[] = [];
    const slotDefs = [
      { tag: "p:regular", weight: "400", style: "normal" as const },
      { tag: "p:bold", weight: "700", style: "normal" as const },
      { tag: "p:italic", weight: "400", style: "italic" as const },
      { tag: "p:boldItalic", weight: "700", style: "italic" as const },
    ];
    for (const fontEl of Array.from(presDoc.getElementsByTagName("p:embeddedFont"))) {
      const typeface = fontEl.getElementsByTagName("p:font")[0]?.getAttribute("typeface");
      if (!typeface) continue;
      for (const def of slotDefs) {
        const rId = fontEl.getElementsByTagName(def.tag)[0]?.getAttribute("r:id");
        const target = rId ? relTargets.get(rId) : null;
        if (!target) continue;
        slots.push({
          typeface,
          weight: def.weight,
          style: def.style,
          zipPath: resolveOoxmlPath("ppt/presentation.xml", target),
        });
      }
    }

    await Promise.all(
      slots.map(async (slot) => {
        try {
          const file = zip.file(slot.zipPath);
          if (!file) return;
          const raw = await file.async("uint8array");
          const fontData = unwrapEot(raw);
          if (!fontData) return; // MTX-compressed or unrecognized — leave to the substitute map

          const face = new FontFace(slot.typeface, fontData.buffer as ArrayBuffer, {
            weight: slot.weight,
            style: slot.style,
          });
          await face.load();
          document.fonts.add(face);
          registered.add(slot.typeface.trim().toLowerCase());
        } catch {
          // one bad font part shouldn't block the rest of the deck's fonts
        }
      })
    );
  } catch {
    // no embedded fonts / not actually a zip / unexpected structure — the
    // substitute map still covers the common named fonts either way
  }
  return registered;
}

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

/**
 * Absolute view state, mirroring PdfViewer's SET_PDF_VIEW. `src` travels with
 * it and is checked on apply, because the parent's replay buffer is keyed by
 * command name rather than by content — a leftover index from a previously
 * shown deck must not be applied to this one.
 *
 * The SET_ prefix is what earns this gateway caching and replay (see
 * viewStateCache in apps/api/src/ws/gateway.ts), which is what makes a deck
 * resume on the slide it was left at when it is pushed again.
 */
interface SlidesView {
  src: string;
  index: number;
}

const EMIT_THROTTLE_MS = 200;

export function SlidesViewer() {
  const params = useSearchParams();
  const src = params.get("src");

  const hostRef = useRef<HTMLDivElement>(null);
  // The parsed file is kept so a resize can re-render without re-downloading.
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const previewerRef = useRef<Previewer | null>(null);
  // Typeface names (lowercased) this specific deck's own embedded fonts were
  // successfully extracted and registered for — patchFonts leaves these alone
  // instead of substituting, since the real font beats any stand-in.
  const embeddedFontsRef = useRef<Set<string>>(new Set());

  const bridgeRef = useRef<FrameBridge | null>(null);
  /** False on the CMS mirror. Only the authoritative instance answers a delta
   * command with an absolute SET_SLIDES_VIEW, or one remote next-slide gets
   * answered twice. */
  const authoritativeRef = useRef(true);
  const lastEmitRef = useRef(0);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingViewRef = useRef<SlidesView | null>(null);
  /** The most recent inbound SET_SLIDES_VIEW, kept even while the deck is
   * still downloading and parsing — the postMessage carrying it lands long
   * before that finishes, so without this the initial render would have
   * nothing left to restore from. */
  const pendingRestoreRef = useRef<SlidesView | null>(null);

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

    const [, embeddedFonts] = await Promise.all([
      previewer.preview(buffer),
      extractEmbeddedFonts(buffer).catch(() => new Set<string>()),
    ]);
    embeddedFontsRef.current = embeddedFonts;
    patchFonts(host, embeddedFonts);

    const count = previewer.slideCount;
    setSlideCount(count);

    // A rebuild mid-deck should land back where the viewer already was.
    const index = count > 0 ? Math.min(startIndex, count - 1) : 0;
    if (index !== 0) {
      previewer.renderSingleSlide(index);
      patchFonts(host, embeddedFontsRef.current);
    }
    setCurrent(index);
  }, []);

  /** Throttled with a guaranteed trailing emit, matching PdfViewer's emitView
   * — holding an arrow key down would otherwise flood the socket and thrash
   * the gateway's LRU cache. */
  const emitView = useCallback((next: SlidesView) => {
    if (!authoritativeRef.current) return;
    pendingViewRef.current = next;

    const flush = () => {
      emitTimerRef.current = null;
      const pending = pendingViewRef.current;
      if (!pending) return;
      pendingViewRef.current = null;
      lastEmitRef.current = Date.now();
      bridgeRef.current?.send("SET_SLIDES_VIEW", pending);
    };

    if (emitTimerRef.current) return; // already scheduled; it'll pick up the newest
    const since = Date.now() - lastEmitRef.current;
    if (since >= EMIT_THROTTLE_MS) flush();
    else emitTimerRef.current = setTimeout(flush, EMIT_THROTTLE_MS - since);
  }, []);

  const goTo = useCallback((index: number, emit = true) => {
    const previewer = previewerRef.current;
    if (!previewer || previewer.slideCount === 0) return;
    // Wrap in both directions, so a screen loops the deck forever.
    const count = previewer.slideCount;
    const next = ((index % count) + count) % count;
    previewer.renderSingleSlide(next);
    const host = hostRef.current;
    if (host) patchFonts(host, embeddedFontsRef.current);
    setCurrent(next);
    if (emit) emitView({ src: resolveSource(src) ?? "", index: next });
  }, [emitView, src]);

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
        // Resume where this deck was left off, if the gateway replayed a
        // position for it while we were still loading. Anything else — a
        // first-ever view, or a stale index belonging to a different deck —
        // starts at the first slide. render() clamps to the real slide count.
        const restore = pendingRestoreRef.current;
        const startIndex = restore && restore.src === source ? restore.index : 0;
        await render(buffer, startIndex);
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
        if (buffer) {
          render(buffer, previewerRef.current?.currentIndex ?? 0).catch((err) => {
            setError(err instanceof Error ? err.message : "Could not read this presentation");
          });
        }
      }, 200);
    });
    observer.observe(host);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [render]);

  // Arrow-key navigation — harmless with no keyboard attached on a real
  // screen, and keeps behavior identical to the CMS preview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        goTo((previewerRef.current?.currentIndex ?? 0) + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        goTo((previewerRef.current?.currentIndex ?? 0) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  // ─── Remote commands ──────────────────────────────────────────────────────
  // Inbound had no path into this iframe until the frame bridge existed, which
  // is why remote next/prev slide never worked here the way it does for PDF.
  useEffect(() => {
    const bridge = connectFrameBridge({
      onInit: ({ preview }) => {
        authoritativeRef.current = !preview;
      },
      onCommand: (command, value) => {
        if (command === "NEXT_PAGE") goTo((previewerRef.current?.currentIndex ?? 0) + 1);
        else if (command === "PREV_PAGE") goTo((previewerRef.current?.currentIndex ?? 0) - 1);
        else if (command === "SET_SLIDES_VIEW") {
          const v = value as SlidesView | undefined;
          if (!v || typeof v.index !== "number") return;
          // Guard against a leftover view for a different deck — the parent's
          // replay buffer is keyed by command, not by content.
          const source = resolveSource(src);
          if (v.src && source && v.src !== source) return;
          // Held for the load effect too: this may well arrive before the deck
          // has been fetched and parsed, in which case there is no previewer
          // to move yet and the initial render must pick it up instead.
          pendingRestoreRef.current = { ...v, src: v.src || source || "" };
          // emit: false — this IS the echo of our own state, or another
          // client's; re-emitting it would loop.
          goTo(v.index, false);
        }
      },
    });
    bridgeRef.current = bridge;
    return () => {
      bridge.disconnect();
      bridgeRef.current = null;
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
      emitTimerRef.current = null;
    };
  }, [goTo, src]);

  const showControls = slideCount > 1 && !loading && !error;

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] text-zinc-100">
      {/*
        The library draws its own next/prev buttons and pagination in "slide"
        mode. They're hidden here in favour of the overlay controls below,
        which match the rest of the display surfaces.
      */}
      <style>{`
        .pptx-preview-wrapper-next,
        .pptx-preview-wrapper-pre,
        .pptx-preview-wrapper-pagination { display: none !important; }
        .pptx-preview-wrapper { background: transparent !important; }
      `}</style>

      {/* Full-bleed now that controls float over the slide instead of
          sharing a flex row with it — the deck gets the entire viewport.
          The outer div is a static clip boundary pinned to the viewport, so
          a deck that letterboxes to a different aspect ratio than the screen
          stays bounded to it rather than spilling past. */}
      <div className="absolute inset-0 overflow-hidden">
        <div ref={hostRef} className="absolute inset-0" />
      </div>

      {loading && <Centered>Loading presentation…</Centered>}
      {error && <Centered tone="error">{error}</Centered>}
      {!loading && !error && slideCount === 0 && <Centered>This presentation has no slides</Centered>}

      {showControls && (
        <div className="absolute bottom-4 left-4 flex items-center gap-3 rounded-full border border-white/10 bg-black/60 px-3 py-2 backdrop-blur-sm">
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
