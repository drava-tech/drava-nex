"use client";

import { useEffect, useRef } from "react";
import type { StreamContent } from "@/types/display";

export function StreamRenderer({
  content,
  preview,
}: {
  content: StreamContent;
  /** True for any CMS-side embed of this screen — audio must only ever come
   * out of the real TV, so this always wins over the asset's own setting. */
  preview?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // See VideoRenderer.tsx — never let a remote MUTE/UNMUTE command unmute a
    // preview, which must always stay silent regardless of the real TV.
    if (preview) return;
    const handleMuteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ muted: boolean }>;
      if (videoRef.current) {
        videoRef.current.muted = customEvent.detail.muted;
      }
    };
    window.addEventListener("screen-mute", handleMuteEvent);
    return () => {
      window.removeEventListener("screen-mute", handleMuteEvent);
    };
  }, [preview]);

  return (
    <video
      ref={videoRef}
      key={content.source}
      src={content.source}
      autoPlay
      playsInline
      muted={preview || (content.muted ?? true)}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        // Matches VideoRenderer — see the note there. cover crops and upscales
        // any source that isn't the panel's aspect ratio.
        objectFit: "contain",
        backgroundColor: "#000",
        display: "block",
      }}
    />
  );
}
