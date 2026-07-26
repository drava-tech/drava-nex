"use client";

import type { HtmlContent } from "@/types/display";

/**
 * Full-screen embedded page. Backs every media kind that isn't natively
 * playable — PDFs, spreadsheets, YouTube and Drive — via the embed URL built by
 * mediaEmbedUrl() in @platform/types.
 *
 * The `allow` list matters: a cross-origin embed only gets autoplay if the
 * parent page delegates it, and without that a kiosk YouTube embed just sits on
 * its first frame.
 */
export function HtmlRenderer({ content }: { content: HtmlContent }) {
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
      }}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
      allow="autoplay; encrypted-media; fullscreen"
    />
  );
}
