"use client";

import { useEffect, useRef } from "react";
import type { VideoContent } from "@/types/display";

interface VideoRendererProps {
  content: VideoContent;
}

export function VideoRenderer({ content }: VideoRendererProps) {
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

  if (!content.source) {
    return (
      <ErrorOverlay message="Video source is missing from the content configuration." />
    );
  }

  return (
    <video
      ref={videoRef}
      key={content.source}       // force remount if source changes
      src={content.source}
      autoPlay
      playsInline
      muted={content.muted}
      loop={content.loop}
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

// ─── Internal helper ──────────────────────────────────────────────────────────

function ErrorOverlay({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100vw",
        height: "100vh",
        backgroundColor: "#0a0a0a",
        color: "#ef4444",
        fontFamily: "system-ui, sans-serif",
        fontSize: "1.25rem",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      {message}
    </div>
  );
}
