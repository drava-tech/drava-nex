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
 * its first frame.
 *
 * The sandbox grants what an interactive page needs (forms, modals, downloads),
 * because a touch screen showing a web page has to be usable — the same set the
 * CMS preview grants, so what was approved there behaves identically here.
 */
export function HtmlRenderer({ content }: { content: HtmlContent }) {
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
        inset: 0,
        width: "100vw",
        height: "100vh",
        border: "none",
        backgroundColor: "#000",
        display: "block",
        touchAction: "auto",
      }}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation"
      allow="autoplay; encrypted-media; fullscreen; clipboard-write"
    />
  );
}
