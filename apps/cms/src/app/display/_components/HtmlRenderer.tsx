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
  // Chromium's built-in PDF viewer is a privileged extension that refuses to
  // run inside a sandboxed iframe at all — it shows a hard "This page has
  // been blocked" screen instead of the document. `source` is the only thing
  // available here (no original asset type is threaded through the WS
  // content model), so detect a raw PDF by its URL shape, matching how
  // mediaEmbedUrl() builds one (`<url ending in .pdf>#view=FitH` etc.).
  const isRawPdf = /\.pdf(#|\?|$)/i.test(content.source);

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
      {...(!isRawPdf && {
        sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-presentation",
      })}
      allow="autoplay; encrypted-media; fullscreen"
    />
  );
}
