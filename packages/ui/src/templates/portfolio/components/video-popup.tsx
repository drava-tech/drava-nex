"use client";

import { useRef } from "react";
import { FilmControlsOverlay } from "./film-controls-overlay";
import { useFilmPlayback } from "./use-film-playback";
import { usePortfolioScreen } from "../screen-context";

/**
 * Full-stage video popup — the overview card's "Watch Video" — with the same
 * transport bar the films player uses, so play/pause/seek here also reach every
 * other client of the screen. Fullscreen and Close are this surface's own.
 */
export function VideoPopup({ src, onClose }: { src: string; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const { mirror } = usePortfolioScreen();
  const playback = useFilmPlayback(src);

  const goFullscreen = () => {
    const el = playback.video as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
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
      <div
        ref={boxRef}
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", width: "78%", maxWidth: 1500 }}
      >
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

        {/* No `controls` — see the note in FilmsGridView. Muted on a CMS mirror,
            because audio only ever leaves the real panel. */}
        <video
          ref={playback.videoRef}
          src={src}
          autoPlay
          playsInline
          muted={mirror}
          style={{
            width: "100%",
            height: "auto",
            maxHeight: "82vh",
            borderRadius: 18,
            background: "#000",
            display: "block",
          }}
        />

        <FilmControlsOverlay playback={playback} surfaceRef={boxRef} />
      </div>
    </div>
  );
}
