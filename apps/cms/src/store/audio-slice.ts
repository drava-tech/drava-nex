import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * The office-wide system audio endpoint (apps/api/src/routes/audio.ts, backed
 * by the native audio-helper bridge) — one physical PC's speakers, not
 * per-screen/per-content audio.
 *
 * This lives in a store rather than a hook because four separate surfaces show
 * the same volume (the Environment card, LiveScreenSurface, ScreenTouchpad and
 * the live-experience control view). As per-component useState they each kept
 * their own copy and drifted apart; here there is physically one value, so they
 * cannot disagree.
 */
export interface AudioState {
  volume: number;
  muted: boolean;
  device: string;
  /**
   * The volume the user has asked for while a write is still queued or in
   * flight, or null when nothing is pending.
   *
   * NAudio's own change notification bounces back over the WebSocket a step or
   * two behind a fast +/- press, so an echo can carry an older value than the
   * one the user just asked for. While this is set, `statusReceived` ignores
   * the echoed volume. It is state rather than a ref (which is how
   * environment-view.tsx did it) so `muted`/`device` can still be applied from
   * the same message — the ref version skipped only `volume`, which let the
   * three fields drift out of sync with each other.
   */
  pendingVolume: number | null;
}

const initialState: AudioState = {
  volume: 50,
  muted: false,
  device: "Detecting…",
  pendingVolume: null,
};

const audioSlice = createSlice({
  name: "audio",
  initialState,
  // Written as mutations, but RTK runs these through Immer — each one produces
  // a new state object rather than editing the existing one in place.
  reducers: {
    /** The hardware's own report, via AUDIO_STATUS_UPDATE or the mount fetch. */
    statusReceived(state, action: PayloadAction<{ volume: number; muted: boolean; device: string }>) {
      state.muted = action.payload.muted;
      state.device = action.payload.device;
      if (state.pendingVolume === null) state.volume = action.payload.volume;
    },
    /** Optimistic: show the new volume immediately, before the POST resolves. */
    volumeQueued(state, action: PayloadAction<number>) {
      state.volume = action.payload;
      state.muted = false;
      state.pendingVolume = action.payload;
    },
    /** The coalescing queue has drained — echoes are trustworthy again. */
    volumeSettled(state) {
      state.pendingVolume = null;
    },
    /** Optimistic mute/unmute; the hardware echo confirms it moments later. */
    muteSetLocally(state, action: PayloadAction<boolean>) {
      state.muted = action.payload;
    },
  },
});

export const { statusReceived, volumeQueued, volumeSettled, muteSetLocally } = audioSlice.actions;
export default audioSlice.reducer;
