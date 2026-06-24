"use client";

import { useLiveStream } from "./use-live-stream";
import type { StreamFit } from "./content";

/**
 * Full-area live-stream player: a <canvas> fed by the WebSocket subscriber hook,
 * with a "Waiting for stream…" placeholder until a publisher is live. Fills its
 * parent — wrap it in a sized box (full screen on a TV, an aspect box in the CMS).
 */
export function LiveStreamCanvas({
  streamId,
  fit = "cover",
  label,
  wsUrl,
  className,
}: {
  streamId: string;
  fit?: StreamFit;
  label?: string;
  wsUrl?: string;
  className?: string;
}) {
  const { live, canvasRef } = useLiveStream(streamId, wsUrl);

  return (
    <div
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", background: "#000", overflow: "hidden" }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          objectFit: fit,
          display: "block",
          visibility: live ? "visible" : "hidden",
        }}
      />
      {!live && <WaitingOverlay streamId={streamId} />}
      {label && live && (
        <div
          style={{
            position: "absolute",
            left: 16,
            bottom: 16,
            padding: "6px 12px",
            borderRadius: 8,
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            fontSize: 14,
            fontFamily: "system-ui, sans-serif",
            letterSpacing: "0.02em",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

function WaitingOverlay({ streamId }: { streamId: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        color: "#6b7280",
        fontFamily: "system-ui, sans-serif",
        background: "#000",
        textAlign: "center",
        padding: "1.5rem",
      }}
    >
      <span style={{ fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase" }}>
        {streamId ? "Waiting for stream…" : "No stream assigned"}
      </span>
      {streamId && (
        <span style={{ fontSize: 12, opacity: 0.6, fontFamily: "monospace" }}>{streamId}</span>
      )}
    </div>
  );
}
