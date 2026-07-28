"use client";

import { useBrowserSession } from "@platform/ui/browser-session";
import type { WebpageContent } from "@/types/display";

/**
 * Full-screen kiosk render of a "link" media asset via services/browser-render
 * (real headless Chromium, top-level navigation) instead of an iframe — this is
 * what backs pages an iframe can't show at all (X-Frame-Options/CSP). See
 * HtmlRenderer for everything that still uses the iframe path (PDFs, sheets,
 * decks, YouTube, Drive).
 *
 * `sessionId` is derived from the asset id (not random) so every screen showing
 * the same pushed page shares one Puppeteer page and one screencast.
 */
export function WebpageRenderer({ content }: { content: WebpageContent }) {
  const session = useBrowserSession(content.source, {
    interactive: false,
    sessionId: `webpage:${content.id}`,
  });

  return (
    <canvas
      ref={session.canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        backgroundColor: "#000",
        display: "block",
      }}
    />
  );
}
