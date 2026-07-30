"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { FilmPlayer } from "./film-player";

/**
 * Embeddable videos grid: 3-column 16:9 tiles with play badges. Tapping a tile
 * opens the FilmPlayer popup (audio on, Fullscreen, manual Next). Player state
 * is local per client (not WS-synced).
 * `frameless`: full-bleed dark page with top padding clearing the header overlay.
 */
export function FilmsPanel({ videos, frameless = false }: { videos: string[]; frameless?: boolean }) {
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);

  if (!videos.length) {
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ background: frameless ? "#141414" : "#e8e8e8", borderRadius: frameless ? 0 : 18 }}
      >
        <p style={{ color: "#888", fontSize: 32 }}>No videos yet</p>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full"
      style={frameless ? { background: "#141414", padding: "160px 48px 48px" } : undefined}
    >
      <div
        className="grid content-start w-full h-full"
        style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 32, overflowY: "auto" }}
      >
        {videos.map((url, i) => (
          <div
            key={`${i}-${url}`}
            role="button"
            tabIndex={0}
            onClick={() => setPlayingIndex(i)}
            className="relative cursor-pointer hover:opacity-80 transition-opacity"
            style={{ background: "#000", borderRadius: 18, aspectRatio: "16 / 9", overflow: "hidden" }}
          >
            <video
              src={url}
              muted
              playsInline
              preload="metadata"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            {/* Play badge */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="flex items-center justify-center"
                style={{
                  background: "rgba(0,0,0,0.55)",
                  color: "#f2f2f2",
                  borderRadius: 999,
                  width: 88,
                  height: 88,
                }}
              >
                <Play size={40} style={{ marginLeft: 6 }} fill="currentColor" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {playingIndex !== null ? (
        <FilmPlayer
          videos={videos}
          index={playingIndex}
          onIndex={setPlayingIndex}
          onClose={() => setPlayingIndex(null)}
        />
      ) : null}
    </div>
  );
}
