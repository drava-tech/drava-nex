"use client";

import type { StreamContent } from "@/types/display";

export function StreamRenderer({ content }: { content: StreamContent }) {
  return (
    <video
      key={content.source}
      src={content.source}
      autoPlay
      playsInline
      muted={content.muted ?? true}
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
