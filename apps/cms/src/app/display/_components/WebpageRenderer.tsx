"use client";

import { useEffect, useRef, useState } from "react";
import { useBrowserSession } from "@platform/ui/browser-session";
import type { WebpageContent } from "@/types/display";

/** Navigation keys forwarded as-is; anything else printable goes through the hidden input's onInput as typed text. */
const SPECIAL_KEYS = ["Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

/** Beyond this pointer travel (px), a press is a scroll-drag, not a tap. */
const DRAG_THRESHOLD = 6;

/**
 * Full-screen kiosk render of a "link" media asset via services/browser-render
 * (real headless Chromium, top-level navigation) instead of an iframe — this is
 * what backs pages an iframe can't show at all (X-Frame-Options/CSP). See
 * HtmlRenderer for everything that still uses the iframe path (PDFs, sheets,
 * decks, YouTube, Drive).
 *
 * `sessionId` is derived from the asset id (not random) so every screen showing
 * the same pushed page shares one Puppeteer page and one screencast.
 *
 * Interactive: a tap relays as a click, a drag relays as a scroll — same
 * distinction the admin Browser tool's mouse/wheel handling makes, just over
 * Pointer Events so touch and mouse both work on whatever the screen actually is.
 */
export function WebpageRenderer({ content }: { content: WebpageContent }) {
  // Render at this screen's own real window size rather than a fixed
  // resolution — Puppeteer lays the page out exactly as wide/tall as the
  // viewport it's told to use, so a hardcoded size (e.g. a blanket 4K) makes
  // every screen render a genuine 4K-desktop layout and then squeezes that
  // frame down to whatever the screen's actual, usually-smaller window is,
  // which reads as the whole page being zoomed way out.
  //
  // Waiting for the real size before mounting WebpageCanvas at all (rather
  // than rendering it early with a guessed/null viewport and correcting
  // later) matters because useBrowserSession's effect that sends
  // BROWSER_SESSION_START is keyed on [sessionId, interactive] only, not on
  // the url/viewport — it runs exactly once, at that component's own mount,
  // so there's no second chance to fix a wrong viewport short of the whole
  // component unmounting and remounting fresh, which is exactly what
  // deferring the mount here achieves.
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    setViewport({ width: window.innerWidth, height: window.innerHeight });
  }, []);

  if (!viewport) return <div style={{ position: "fixed", inset: 0, backgroundColor: "#000" }} />;

  return <WebpageCanvas content={content} viewport={viewport} />;
}

function WebpageCanvas({
  content,
  viewport,
}: {
  content: WebpageContent;
  viewport: { width: number; height: number };
}) {
  const session = useBrowserSession(content.source, {
    interactive: true,
    sessionId: `webpage:${content.id}`,
    viewport,
  });

  const canvasRef = session.canvasRef;
  const pointerRef = useRef<{ id: number; startX: number; startY: number; lastY: number; dragging: boolean } | null>(
    null
  );
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  // Stable ref so the wheel listener always calls the latest session.scroll
  // without being re-attached every render.
  const scrollRef = useRef(session.scroll);
  scrollRef.current = session.scroll;

  // Attach wheel listener as non-passive so preventDefault() actually works,
  // preventing the host page from scrolling instead of the remote browser.
  // React's synthetic onWheel is passive in newer versions and cannot call preventDefault().
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      scrollRef.current(e.deltaY);
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  // canvasRef.current is set once at mount; no need to re-attach on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointerRef.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastY: e.clientY, dragging: false };
        }}
        onPointerMove={(e) => {
          const p = pointerRef.current;
          if (!p || p.id !== e.pointerId) return;
          const dy = e.clientY - p.lastY;
          if (!p.dragging && (Math.abs(e.clientX - p.startX) > DRAG_THRESHOLD || Math.abs(e.clientY - p.startY) > DRAG_THRESHOLD)) {
            p.dragging = true;
          }
          // dy > 0 means finger/cursor moved down → content should scroll up → send positive deltaY
          // ponytail: inverted from native scroll because this is a drag-to-pan gesture
          if (p.dragging) session.scroll(-dy);
          p.lastY = e.clientY;
        }}
        onPointerUp={(e) => {
          const p = pointerRef.current;
          if (p && p.id === e.pointerId && !p.dragging) {
            session.click(e.clientX, e.clientY);
            hiddenInputRef.current?.focus();
          }
          pointerRef.current = null;
        }}
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          // objectFit: contain keeps aspect ratio correct but the click
          // coordinate mapping in useBrowserSession already accounts for this
          // via getBoundingClientRect(), so clicks land correctly even with letterbox.
          objectFit: "contain",
          backgroundColor: "#000",
          display: "block",
          // touchAction none prevents the browser from hijacking pointer events
          // for native scroll/zoom — all interaction is relayed to Puppeteer.
          touchAction: "none",
          cursor: "default",
        }}
      />
      {/* Invisible focus target that turns keystrokes into BROWSER_CONTROL
          messages — same trick as the admin Browser tool (browser-view.tsx). */}
      <input
        ref={hiddenInputRef}
        className="pointer-events-none absolute h-px w-px opacity-0"
        aria-hidden="true"
        onKeyDown={(e) => {
          if (SPECIAL_KEYS.includes(e.key)) {
            e.preventDefault();
            session.sendKey(e.key);
          }
        }}
        onInput={(e) => {
          const el = e.target as HTMLInputElement;
          if (el.value) {
            session.type(el.value);
            el.value = "";
          }
        }}
      />
    </>
  );
}
