"use client";

import { LiveStreamCanvas, type StreamFit } from "@platform/ui/templates/live-stream";

/**
 * Full-screen live-stream player for a TV. Subscribes to `streamId` over the WS
 * gateway and paints incoming frames; shows a standby placeholder until the
 * publisher EXE is live. Keyed by streamId at the call site so a reassignment
 * cleanly tears down the old subscription and opens the new one.
 */
export function LiveStreamRenderer({
  streamId,
  fit,
  label,
}: {
  streamId: string;
  fit?: StreamFit;
  label?: string;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", background: "#000" }}>
      <LiveStreamCanvas streamId={streamId} fit={fit} label={label} />
    </div>
  );
}
