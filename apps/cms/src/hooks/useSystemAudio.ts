"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The office-wide system audio endpoint (apps/api/src/routes/audio.ts,
 * backed by the native audio-helper bridge) — one physical PC's speakers,
 * not per-screen/per-content audio, so it's independent of whatever's
 * currently assigned to the screen.
 */
export function useSystemAudio() {
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/audio/status")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (typeof data?.volume === "number") setVolume(data.volume);
        if (typeof data?.muted === "boolean") setMuted(data.muted);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const adjustVolume = useCallback(
    (delta: number) => {
      const base = muted ? 0 : volume;
      const next = Math.max(0, Math.min(100, base + delta));
      setVolume(next);
      setMuted(false);
      fetch("/api/audio/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volume: next }),
      }).catch(() => {});
    },
    [volume, muted]
  );

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    fetch("/api/audio/toggle-mute", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (typeof data?.muted === "boolean") setMuted(data.muted);
      })
      .catch(() => {});
  }, [muted]);

  return { volume, muted, adjustVolume, toggleMute };
}
