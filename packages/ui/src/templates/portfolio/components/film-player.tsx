"use client";

import { useRef } from "react";

/**
 * Popup player for the films grid: plays one video with audio (native controls),
 * with Fullscreen, Close, and a manual Next button cycling through the list
 * (wrap-around). Also auto-advances to the next video when one ends, so a
 * company's films play back-to-back like a slideshow, wrapping to the first
 * after the last — the manual Next button still works too, for skipping ahead.
 */
export function FilmPlayer({
  videos,
  index,
  onIndex,
  onClose,
}: {
  videos: string[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const src = videos[index];

  const goFullscreen = () => {
    const el = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!el) return;
    if (el.requestFullscreen) void el.requestFullscreen().catch(() => {});
    else if (el.webkitEnterFullscreen) el.webkitEnterFullscreen();
  };

  const close = () => {
    if (typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    onClose();
  };

  const controlButtonStyle = {
    background: "#ffffff",
    color: "#1f1f1f",
    border: "none",
    borderRadius: 999,
    padding: "12px 28px",
    fontSize: 24,
    fontWeight: 500,
    cursor: "pointer",
  } as const;

  if (!src) return null;

  return (
    <div
      onClick={close}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.88)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "78%", maxWidth: 1500 }}>
        {/* Controls */}
        <div style={{ position: "absolute", top: -64, right: 0, display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 24, fontWeight: 400 }}>
            {index + 1} / {videos.length}
          </span>
          {videos.length > 1 ? (
            <button onClick={() => onIndex((index + 1) % videos.length)} style={controlButtonStyle}>
              Next ›
            </button>
          ) : null}
          <button onClick={goFullscreen} style={controlButtonStyle}>
            ⛶ Fullscreen
          </button>
          <button
            onClick={close}
            aria-label="Close"
            style={{
              background: "rgba(255,255,255,0.16)",
              color: "#ffffff",
              border: "none",
              borderRadius: 999,
              width: 56,
              height: 56,
              fontSize: 28,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {/* key={src} remounts the element on Next so the new source autoplays cleanly */}
        <video
          key={src}
          ref={videoRef}
          src={src}
          controls
          autoPlay
          playsInline
          onEnded={() => {
            if (videos.length > 1) onIndex((index + 1) % videos.length);
          }}
          style={{ width: "100%", height: "auto", maxHeight: "82vh", borderRadius: 18, background: "#000", display: "block" }}
        />
      </div>
    </div>
  );
}
