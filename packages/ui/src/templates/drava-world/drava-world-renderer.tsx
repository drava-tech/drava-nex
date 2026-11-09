"use client";

import { DRAVA_WORLD_URL } from "./content";

/**
 * Renders Drava World full-bleed — the standalone app, unchanged. Used by the
 * CMS preview/editor and the live display alike.
 *
 * Drava World is its own multi-page app (a three.js walkthrough plus its
 * kiosk pages), so it runs in an iframe rather than being mounted into React,
 * the same way the Drava Mosaic template hosts the studio. That keeps its
 * globals, listeners and WebGL contexts isolated, and unmounting the iframe
 * releases all of them at once.
 */
export function DravaWorldRenderer({ src = DRAVA_WORLD_URL }: { src?: string }) {
  return (
    <iframe
      src={src}
      title="Drava World"
      // autoplay: the brand film and TRAVIS's voice; fullscreen and pointer
      // lock for walking around; microphone for talking to TRAVIS.
      allow="autoplay; fullscreen; pointer-lock; microphone"
      allowFullScreen
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        border: 0,
        background: "#07080b",
      }}
    />
  );
}
