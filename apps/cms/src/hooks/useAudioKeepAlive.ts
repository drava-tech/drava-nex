"use client";

import { useEffect } from "react";

/**
 * Inaudible, but deliberately NOT digital silence. Chromium can idle an output
 * stream that is provably silent, and a sink watching for silence will power
 * its audio stage back down — either one defeats the whole point of this hook.
 * At 1e-4 (-80 dBFS) the samples are non-zero on the wire and inaudible in the
 * room.
 */
const KEEP_ALIVE_GAIN = 1e-4;

/**
 * Holds the display's audio output device permanently open.
 *
 * Chromium tears down its output stream whenever nothing on the page is
 * playing, and an HDMI/eARC audio path — plus any soundbar or AVR behind it —
 * powers its audio stage down shortly after that. Waking it back up costs
 * roughly a second, and the browser pays that cost afresh on *every* playback
 * start: each content push, and each pause -> play. Meanwhile the video
 * renderer is under no such constraint and starts painting immediately, so the
 * picture runs, the sound arrives about a second late, and the audio renderer
 * then discards the backlog to re-lock to the clock — audible as a swallowed
 * word or a clipped beat right at the moment it catches up.
 *
 * A permanently-running (near-)silent Web Audio graph keeps that stream open
 * across content swaps, so no playback ever has to wake the sink. Mount it once
 * at the player level rather than per renderer: the device has to stay open
 * *between* pushes, which is exactly the window a per-content hook would miss.
 *
 * Real-TV only — a CMS-side mirror must stay silent, and has no sink to keep
 * awake anyway.
 */
export function useAudioKeepAlive(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      // A browser that refuses to construct one at all: nothing to keep alive.
      return;
    }

    const gain = ctx.createGain();
    gain.gain.value = KEEP_ALIVE_GAIN;
    gain.connect(ctx.destination);
    const source = ctx.createConstantSource();
    source.connect(gain);
    source.start();

    // An AudioContext is born `suspended` without a user gesture. On the kiosk
    // the host's --autoplay-policy=no-user-gesture-required flag
    // (tools/main-screen-kiosk/MainWindow.xaml.cs) means this resolves straight
    // away; the listeners below cover every other viewer, and re-resume after
    // Chromium suspends the context while the tab is hidden.
    const resume = () => {
      if (ctx.state !== "running") void ctx.resume().catch(() => {});
    };
    resume();

    // `play` does not bubble, hence the capture phase — this catches the first
    // successful playback on the page, which is a gesture-equivalent moment on
    // any viewer where autoplay was already allowed.
    window.addEventListener("play", resume, true);
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    document.addEventListener("visibilitychange", resume);

    return () => {
      window.removeEventListener("play", resume, true);
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      document.removeEventListener("visibilitychange", resume);
      try {
        source.stop();
      } catch {
        // Already stopped; nothing to do.
      }
      source.disconnect();
      gain.disconnect();
      void ctx.close().catch(() => {});
    };
  }, [enabled]);
}
