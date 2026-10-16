"use client";

import {
  DEFAULT_DATA_ART_STUDIO_CONTENT,
  dataArtStudioUrl,
  type DataArtStudioContent,
} from "./content";

/**
 * Renders a Data Art Studio experience full-bleed. Used by the CMS
 * preview/editor and the live display alike.
 *
 * The studio is its own multi-page app (three WebGL/video pages built by
 * packages/data-art-studio), so it runs in a same-origin iframe rather than
 * being mounted into React — the same way the studio itself hosts its Flight
 * Garden and World Clock. That keeps every page's globals, listeners and WebGL
 * contexts isolated, and unmounting the iframe releases all of them at once.
 *
 * Keyed on the URL so a content push that changes the page or the clock
 * reloads it; a push that changes nothing leaves the running page alone.
 */
export function DataArtStudioRenderer({
  content,
  baseUrl,
}: {
  content?: DataArtStudioContent | null;
  /** Where the built studio is served. Defaults to /data-art-studio/. */
  baseUrl?: string;
}) {
  const src = dataArtStudioUrl(content ?? DEFAULT_DATA_ART_STUDIO_CONTENT, baseUrl);

  return (
    <iframe
      key={src}
      src={src}
      title="Data Art Studio"
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
