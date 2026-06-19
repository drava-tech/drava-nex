"use client";

import type { ImageContent } from "@/types/display";

export function ImageRenderer({ content }: { content: ImageContent }) {
  return (
    <img
      key={content.source}
      src={content.source}
      alt=""
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        objectFit: "cover",
        backgroundColor: "#000",
        display: "block",
      }}
    />
  );
}
