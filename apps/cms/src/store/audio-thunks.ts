import { statusReceived, volumeQueued, volumeSettled, muteSetLocally } from "./audio-slice";
import type { AppDispatch, RootState } from "./index";

/**
 * Coalescing queue for volume writes, ported from environment-view.tsx's
 * pendingVolumeRef/isSendingVolumeRef pair. A held +/- press must collapse to
 * the latest value instead of firing one request per tap — the command has to
 * cross a WebSocket to a native Windows helper, so blasting it is both slow and
 * pointless when only the final value matters.
 *
 * Module scope rather than component refs: every surface now shares one queue,
 * so two components pressing +/- at once can't run competing send loops.
 */
let pendingVolume: number | null = null;
let isSending = false;

/** How long to wait after a write settles before sending the next queued value. */
const SEND_GAP_MS = 50;

/**
 * None of these apply the POST response body. Those endpoints return the cache
 * from *before* the command round-trips (apps/api/src/routes/audio.ts), so the
 * body is a pre-command snapshot — applying it to `muted` made the mute button
 * visibly flip and snap straight back. The optimistic value plus the hardware's
 * own AUDIO_STATUS_UPDATE echo is the truthful path.
 */
export const setVolume = (volume: number) => (dispatch: AppDispatch) => {
  const clamped = Math.max(0, Math.min(100, Math.round(volume)));
  dispatch(volumeQueued(clamped));
  pendingVolume = clamped;
  if (isSending) return;

  const sendNext = () => {
    if (pendingVolume === null) {
      isSending = false;
      dispatch(volumeSettled());
      return;
    }
    const volToSend = pendingVolume;
    pendingVolume = null;
    isSending = true;

    fetch("/api/audio/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ volume: volToSend }),
    })
      .catch((err) => console.error("Error setting volume:", err))
      .finally(() => { setTimeout(sendNext, SEND_GAP_MS); });
  };

  sendNext();
};

/** Step the volume, treating a muted device as 0 so "+" unmutes into a sane level. */
export const adjustVolume = (delta: number) => (dispatch: AppDispatch, getState: () => RootState) => {
  const { volume, muted } = getState().audio;
  dispatch(setVolume((muted ? 0 : volume) + delta));
};

export const setMuted = (muted: boolean) => (dispatch: AppDispatch) => {
  dispatch(muteSetLocally(muted));
  fetch(muted ? "/api/audio/mute" : "/api/audio/unmute", { method: "POST" })
    .catch((err) => console.error("Error setting mute:", err));
};

export const toggleMute = () => (dispatch: AppDispatch, getState: () => RootState) => {
  dispatch(muteSetLocally(!getState().audio.muted));
  fetch("/api/audio/toggle-mute", { method: "POST" })
    .catch((err) => console.error("Error toggling mute:", err));
};

/**
 * One-shot read of the device's current state, for first paint. The gateway
 * also replays the latest status to every socket on CMS_REGISTER, so this only
 * fills the UI in a little sooner than the handshake would.
 *
 * Returns a cleanup-aware promise guard: React may unmount before it resolves.
 */
export const fetchAudioStatus = () => (dispatch: AppDispatch) => {
  let cancelled = false;
  fetch("/api/audio/status")
    .then((res) => res.json())
    .then((data) => {
      if (cancelled) return;
      if (typeof data?.volume === "number" && typeof data?.muted === "boolean") {
        dispatch(statusReceived({
          volume: data.volume,
          muted: data.muted,
          device: data.device ?? "Unknown Device",
        }));
      }
    })
    .catch((err) => console.error("Failed to fetch audio status:", err));
  return () => { cancelled = true; };
};
