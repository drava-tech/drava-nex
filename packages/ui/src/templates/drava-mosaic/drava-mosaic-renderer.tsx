"use client";

import { DRAVA_MOSAIC_URL } from "./content";

/**
 * Renders the Drava Mosaic full-bleed — the standalone app, unchanged. Used
 * by the CMS preview/editor and the live display alike.
 *
 * The studio is its own multi-page app (three WebGL/video pages built by
 * packages/drava-mosaic), so it runs in a same-origin iframe rather than
 * being mounted into React — the same way the studio itself hosts its Flight
 * Garden and World Clock. That keeps every page's globals, listeners and WebGL
 * contexts isolated, and unmounting the iframe releases all of them at once.
 */
export function DravaMosaicRenderer({ src = DRAVA_MOSAIC_URL }: { src?: string }) {
  return (
    <iframe
      src={src}
      title="Drava Mosaic"
      // autoplay: the art is muted video, but some players gate even that.
      allow="autoplay; fullscreen"
      allowFullScreen
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        border: 0,
        background: "#05070a",
      }}
    />
  );
}
