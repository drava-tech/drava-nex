"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Debug camera preview — shows the latest JPEG (boxes drawn server-side by
 * services/vision) so detection can be confirmed visually without a separate
 * local script. `cameraId` must match VISION_CAMERAS in the vision service's .env.
 *
 * Deliberately its own component. The refresh used to live in VisitorsClient as
 * a `snapshotTick` state bumped every 1.5s — which re-rendered the entire
 * visitors page, table included, forever, purely to change one query string.
 * Here the interval writes `img.src` through a ref instead, so refreshing the
 * frame costs no React render at all: this component re-renders only when the
 * snapshot flips between available and unavailable.
 */
export function CameraSnapshot({
  cameraId,
  intervalMs = 1500,
}: {
  cameraId: string;
  intervalMs?: number;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      const el = imgRef.current;
      // Skip while the tab is hidden — nobody is looking, and it keeps the
      // vision service from serving frames into a background tab.
      if (!el || document.hidden) return;
      el.src = `/api/vision-snapshot/${cameraId}?t=${Date.now()}`;
    }, intervalMs);
    return () => clearInterval(id);
  }, [cameraId, intervalMs]);

  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Camera preview ({cameraId}) — green box = counts as present, red = too small/far
      </p>
      {!available && (
        <p className="mb-2 text-sm text-muted-foreground">
          No recent snapshot — is the vision pipeline running?
        </p>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={`/api/vision-snapshot/${cameraId}`}
        alt="Live camera detection preview"
        className={`max-h-80 rounded-md border bg-black ${available ? "" : "hidden"}`}
        onError={() => setAvailable(false)}
        onLoad={() => setAvailable(true)}
      />
    </div>
  );
}
