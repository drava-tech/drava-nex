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
        // "contain", not "cover", the same as VideoRenderer: the whole image
        // shows. A wide one touches the left and right edges, a tall one the
        // top and bottom, and the rest is the black ground below. Cover zoomed
        // in and cut the edges off anything that wasn't the panel's shape.
        objectFit: "contain",
        backgroundColor: "#000",
        display: "block",
      }}
    />
  );
}
