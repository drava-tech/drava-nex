"use client";

import { useEffect, useRef } from "react";
import type { VideoContent } from "@/types/display";

interface VideoRendererProps {
  content: VideoContent;
  /** True for any CMS-side embed of this screen (Screens control page, Live
   * Control popup, ...) — audio must only ever come out of the real TV, so
   * this always wins over the asset's own `muted` setting. */
  preview?: boolean;
}

export function VideoRenderer({ content, preview }: VideoRendererProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // A remote MUTE/UNMUTE command reaches every client of this screen,
    // including CMS-side mirrors — never let it unmute a preview, which must
    // always stay silent regardless of what the real TV is doing.
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

  // The `autoPlay` attribute below can't surface a blocked-playback promise
  // rejection — if the browser blocks unmuted autoplay (kiosk host missing
  // the --autoplay-policy flag, or any other viewer without it), the element
  // just sits frozen on its first frame with no error anywhere. This calls
  // play() explicitly so a rejection can be caught, falling back to muted
  // playback so the video still plays instead of staying dead. No "tap to
  // unmute" affordance: this is an unattended kiosk display, nobody's there
  // to click it (unlike welcome-renderer.tsx, which has a real click path).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => {
      if (!video.muted) {
        video.muted = true;
        video.play().catch(() => {});
      }
    });
  }, [content.source]);

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
      muted={preview || content.muted}
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
