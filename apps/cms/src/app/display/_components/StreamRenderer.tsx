"use client";

import { useEffect, useRef } from "react";
import type { StreamContent } from "@/types/display";

export function StreamRenderer({ content }: { content: StreamContent }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
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
  }, []);

  return (
    <video
      ref={videoRef}
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
