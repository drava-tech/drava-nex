"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Centered, resolveSource } from "../../_components/viewer-common";
import { connectFrameBridge } from "@/lib/display/frame-bridge";
import { ZOOM_IN, ZOOM_OUT, clampZoom, stepZoom } from "@/lib/display/zoom-protocol";

/** Body text size at zoom 1. Everything else in .word-doc is sized in `em`, so
 * scaling this one value scales the whole document proportionally. */
const BASE_FONT_PX = 16;

/**
 * Absolute view state, mirroring PdfView / SlidesView. Only zoom for now —
 * this viewer had no remote control of any kind before, so scroll-position
 * resume is a separate follow-up rather than something to bundle in here.
 *
 * `src` travels with it and is checked on apply, because the parent's replay
 * buffer is keyed by command name rather than by content. The SET_ prefix is
 * what earns the gateway caching and replay that makes a document come back at
 * the zoom it was left at.
 */
interface WordView {
  src: string;
  zoom?: number;
}

export function WordViewer() {
  const params = useSearchParams();
  const src = params.get("src");

  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);

  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  /** False on the CMS mirror. Only the authoritative instance answers a delta
   * command with an absolute SET_WORD_VIEW, or one remote zoom is echoed
   * twice. */
  const authoritativeRef = useRef(true);

  const load = useCallback(async (source: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status})`);

      // Imported lazily so mammoth (and its dependencies) never land in the
      // shared bundle — this route is the only thing that needs it. The
      // browser-specific entry point avoids mammoth's Node/fs-dependent code.
      const mammoth = await import("mammoth/mammoth.browser");
      const arrayBuffer = await res.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      setHtml(result.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read this document");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const source = resolveSource(src);
    if (!source) {
      setError("No document specified");
      setLoading(false);
      return;
    }
    void load(source);
  }, [src, load]);

  // ─── Remote commands ──────────────────────────────────────────────────────
  // This viewer had no inbound path at all until now — it rendered whatever it
  // was given and ignored every command the display page relayed.
  useEffect(() => {
    const bridge = connectFrameBridge({
      onInit: ({ preview }) => {
        authoritativeRef.current = !preview;
      },
      onCommand: (command, value) => {
        if (command === ZOOM_IN || command === ZOOM_OUT) {
          const next = stepZoom(zoomRef.current, command === ZOOM_IN ? "in" : "out");
          if (next === zoomRef.current) return; // at the clamp limit
          zoomRef.current = next;
          setZoom(next);
          if (authoritativeRef.current) {
            bridge.send("SET_WORD_VIEW", { src: resolveSource(src) ?? "", zoom: next } as WordView);
          }
        } else if (command === "SET_WORD_VIEW") {
          const v = value as WordView | undefined;
          if (!v) return;
          // Guard against a leftover view for a different document — the
          // parent's replay buffer is keyed by command, not by content.
          const source = resolveSource(src);
          if (v.src && source && v.src !== source) return;
          const restored = clampZoom(v.zoom);
          zoomRef.current = restored;
          setZoom(restored);
        }
      },
    });
    return () => bridge.disconnect();
  }, [src]);

  if (loading) {
    return <Centered>Loading document…</Centered>;
  }

  if (error) {
    return <Centered tone="error">{error}</Centered>;
  }

  if (!html) {
    return <Centered>This document is empty</Centered>;
  }

  return (
    <div className="fixed inset-0 overflow-auto bg-[#0a0a0a]">
      <div
        className="word-doc mx-auto max-w-3xl px-8 py-12 text-zinc-200"
        // Zoom reflows rather than magnifying: everything in .word-doc below is
        // sized in `em`, so scaling the root size scales the whole document and
        // the text stays crisp at any factor — the right behaviour for a
        // continuous-text viewer, unlike the fixed-canvas PDF and slide ones.
        style={{ fontSize: `${BASE_FONT_PX * zoom}px` }}
        // mammoth's output is semantic HTML converted from a document the
        // admin uploaded or emailed themselves — same trust level as the PDF/
        // pptx content this same route family already renders unsanitized.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <style jsx global>{`
        /* font-size is set inline so remote zoom can drive it — see above. */
        .word-doc {
          line-height: 1.7;
        }
        .word-doc h1, .word-doc h2, .word-doc h3, .word-doc h4 {
          font-weight: 600;
          color: #fafafa;
          margin: 1.5em 0 0.5em;
        }
        .word-doc h1 { font-size: 2em; }
        .word-doc h2 { font-size: 1.5em; }
        .word-doc h3 { font-size: 1.25em; }
        .word-doc p { margin: 0.75em 0; }
        .word-doc a { color: #60a5fa; text-decoration: underline; }
        .word-doc strong { font-weight: 700; color: #fafafa; }
        .word-doc ul, .word-doc ol { margin: 0.75em 0; padding-left: 1.5em; }
        .word-doc li { margin: 0.25em 0; }
        .word-doc img { max-width: 100%; height: auto; margin: 1em 0; }
        .word-doc table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        .word-doc td, .word-doc th {
          border: 1px solid rgba(255, 255, 255, 0.15);
          padding: 0.5em 0.75em;
        }
        .word-doc th { font-weight: 600; background: rgba(255, 255, 255, 0.05); }
      `}</style>
    </div>
  );
}
