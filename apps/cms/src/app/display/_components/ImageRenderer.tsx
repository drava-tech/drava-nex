"use client";

import type { ImageContent } from "@/types/display";

export function ImageRenderer({
  content,
  onReady,
}: {
  content: ImageContent;
  /** Decoded and ready to paint — what the push transition waits on. Fired on
   * error too, so a broken URL still lets the push complete. */
  onReady?: () => void;
}) {
  return (
    <img
      key={content.source}
      src={content.source}
      alt=""
      onLoad={onReady}
      onError={onReady}
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
