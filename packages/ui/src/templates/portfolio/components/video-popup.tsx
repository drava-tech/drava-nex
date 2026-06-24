"use client";

import { useRef } from "react";

/** Full-stage video popup with Fullscreen + Close controls. */
export function VideoPopup({ src, onClose }: { src: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

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
        <div style={{ position: "absolute", top: -64, right: 0, display: "flex", gap: 16 }}>
          <button
            onClick={goFullscreen}
            style={{
              background: "#ffffff",
              color: "#1f1f1f",
              border: "none",
              borderRadius: 999,
              padding: "12px 28px",
              fontSize: 24,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
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

        <video
          ref={videoRef}
          src={src}
          controls
          autoPlay
          playsInline
          style={{ width: "100%", height: "auto", maxHeight: "82vh", borderRadius: 18, background: "#000", display: "block" }}
        />
      </div>
    </div>
  );
}
