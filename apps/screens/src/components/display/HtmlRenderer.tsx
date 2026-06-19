"use client";

import type { HtmlContent } from "@/types/display";

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
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  );
}
