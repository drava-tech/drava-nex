"use client";

import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import * as audioThunks from "@/store/audio-thunks";

/**
 * The office-wide system audio endpoint (apps/api/src/routes/audio.ts, backed
 * by the native audio-helper bridge) — one physical PC's speakers, not
 * per-screen/per-content audio, so it's independent of whatever's currently
 * assigned to the screen.
 *
 * Backed by the Redux store rather than local state: the same volume is shown
 * on four separate surfaces, and as per-component useState each one froze at
 * whatever it read on mount. Reading from the store means they all track the
 * hardware live, including changes made outside the CMS entirely (the PC's
 * volume keys, the soundbar's own remote).
 */
export function useSystemAudio() {
  const dispatch = useAppDispatch();
  const volume = useAppSelector((s) => s.audio.volume);
  const muted = useAppSelector((s) => s.audio.muted);
  const device = useAppSelector((s) => s.audio.device);

  const adjustVolume = useCallback((delta: number) => { dispatch(audioThunks.adjustVolume(delta)); }, [dispatch]);
  const setVolume = useCallback((next: number) => { dispatch(audioThunks.setVolume(next)); }, [dispatch]);
  const setMuted = useCallback((next: boolean) => { dispatch(audioThunks.setMuted(next)); }, [dispatch]);
  const toggleMute = useCallback(() => { dispatch(audioThunks.toggleMute()); }, [dispatch]);

  return { volume, muted, device, adjustVolume, setVolume, setMuted, toggleMute };
}
