"use client";

import { useEffect } from "react";
import type { HtmlContent } from "@/types/display";

/**
 * Full-screen embedded page. Backs every media kind that isn't natively
 * playable — PDFs, spreadsheets, YouTube, Drive and arbitrary web pages — via
 * the embed URL built by mediaEmbedUrl() in @platform/types.
 *
 * The `allow` list matters: a cross-origin embed only gets autoplay if the
 * parent page delegates it, and without that a kiosk YouTube embed just sits on
 * its first frame. `preview` deliberately withholds that delegation — audio
 * must only ever come out of the real TV, never a CMS-side mirror — which
 * blocks audible autoplay for any provider uniformly (muted/silent autoplay,
 * i.e. the visual motion, is still allowed either way).
 *
 * The sandbox grants what an interactive page needs (forms, modals, downloads),
 * because a touch screen showing a web page has to be usable — the same set the
 * CMS preview grants, so what was approved there behaves identically here.
 */
export function HtmlRenderer({
  content,
  preview,
}: {
  content: HtmlContent;
  /** True for any CMS-side embed of this screen — never delegate the
   * autoplay permission here, so an embedded YouTube/Vimeo/SoundCloud/etc.
   * player can't produce sound in the CMS, only on the real TV. */
  preview?: boolean;
}) {
  // Chromium's built-in PDF viewer is a privileged extension that refuses to
  // run inside a sandboxed iframe at all — it shows a hard "This page has
  // been blocked" screen instead of the document. `source` is the only thing
  // available here (no original asset type is threaded through the WS
  // content model), so detect a raw PDF by its URL shape, matching how
  // mediaEmbedUrl() builds one (`<url ending in .pdf>#view=FitH` etc.).
  const isRawPdf = /\.pdf(#|\?|$)/i.test(content.source);

  // The display page pins `touch-action: none` on html/body so signage can't be
  // panned or pinch-zoomed by a passer-by. Touch-action is intersected down the
  // ancestor chain and that chain crosses into the frame, so leaving it set
  // would mean a touch screen could tap inside an embedded page but never
  // scroll it. Relaxed only while a page is on screen, and put back on unmount
  // so image/video content keeps the gesture lock it wants.
  useEffect(() => {
    const { style } = document.documentElement;
    const bodyStyle = document.body.style;
    const previous = { root: style.touchAction, body: bodyStyle.touchAction };

    style.touchAction = "auto";
    bodyStyle.touchAction = "auto";

    return () => {
      style.touchAction = previous.root;
      bodyStyle.touchAction = previous.body;
    };
  }, []);

  return (
    <iframe
      key={content.source}
      src={content.source}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        // A few px wider than the viewport: many pushed pages are taller than
        // one screen and grow their own native scrollbar, which otherwise
        // shows up as a bare strip (the iframe's background) on the right
        // edge. Overhanging the extra width pushes that scrollbar off-screen,
        // where the display page's own `overflow:hidden` (see html/body style
        // in [screenId]/page.tsx) clips it away.
        width: "calc(100vw + 20px)",
        height: "100vh",
        border: "none",
        backgroundColor: "#000",
        display: "block",
        touchAction: "auto",
      }}
      {...(!isRawPdf && {
        sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation",
      })}
      allow={preview ? "encrypted-media; fullscreen; clipboard-write" : "autoplay; encrypted-media; fullscreen; clipboard-write"}
    />
  );
}
