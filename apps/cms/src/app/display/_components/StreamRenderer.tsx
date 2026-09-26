"use client";

import { useEffect, useRef } from "react";
import type { StreamContent } from "@/types/display";

export function StreamRenderer({
  content,
  preview,
  outgoing,
  onReady,
}: {
  content: StreamContent;
  /** True for any CMS-side embed of this screen — audio must only ever come
   * out of the real TV, so this always wins over the asset's own setting. */
  preview?: boolean;
  /** Sliding away and about to unmount — see VideoRenderer.tsx. */
  outgoing?: boolean;
  /** First frame decoded; the push transition waits on this. */
  onReady?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Frees the decoder for the incoming layer while the last frame stays
  // painted, so a stream → video push costs one live decode, not two.
  useEffect(() => {
    if (outgoing) videoRef.current?.pause();
  }, [outgoing]);

  useEffect(() => {
    // See VideoRenderer.tsx — never let a remote MUTE/UNMUTE command unmute a
    // preview, which must always stay silent regardless of the real TV.
    if (preview || outgoing) return;
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
  }, [preview, outgoing]);

  return (
    <video
      ref={videoRef}
      key={content.source}
      src={content.source}
      autoPlay
      playsInline
      onLoadedData={onReady}
      onError={onReady}
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
