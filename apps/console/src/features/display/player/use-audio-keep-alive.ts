// Ported verbatim from cms-platform apps/cms/src/hooks/useAudioKeepAlive.ts.

import { useEffect } from "react"

/**
 * Inaudible, but deliberately NOT digital silence. Chromium can idle an output
 * stream that is provably silent, and a sink watching for silence will power
 * its audio stage back down — either one defeats the whole point of this hook.
 * At 1e-4 (-80 dBFS) the samples are non-zero on the wire and inaudible in the
 * room.
 */
const KEEP_ALIVE_GAIN = 1e-4

/**
 * Holds the display's audio output device permanently open.
 *
 * Chromium tears down its output stream whenever nothing on the page is
 * playing, and an HDMI/eARC audio path — plus any soundbar or AVR behind it —
 * powers its audio stage down shortly after that. Waking it back up costs
 * roughly a second, paid afresh on every playback start. The picture runs, the
 * sound arrives about a second late, and the audio renderer then discards the
 * backlog to re-lock — audible as a swallowed word at the start of every push.
 *
 * A permanently-running near-silent Web Audio graph keeps that stream open
 * across content swaps. Mount it once at the player level: the device has to
 * stay open *between* pushes, which a per-content hook would miss.
 */
export function useAudioKeepAlive(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return

    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    let ctx: AudioContext
    try {
      ctx = new Ctor()
    } catch {
      return
    }

    const gain = ctx.createGain()
    gain.gain.value = KEEP_ALIVE_GAIN
    gain.connect(ctx.destination)
    const source = ctx.createConstantSource()
    source.connect(gain)
    source.start()

    // An AudioContext is born `suspended` without a user gesture. A kiosk
    // browser launched with --autoplay-policy=no-user-gesture-required resumes
    // straight away; the listeners cover every other viewer, and re-resume
    // after Chromium suspends the context while the tab is hidden.
    const resume = () => {
      if (ctx.state !== "running") void ctx.resume().catch(() => {})
    }
    resume()

    // `play` does not bubble, hence the capture phase.
    window.addEventListener("play", resume, true)
    window.addEventListener("pointerdown", resume)
    window.addEventListener("keydown", resume)
    document.addEventListener("visibilitychange", resume)

    return () => {
      window.removeEventListener("play", resume, true)
      window.removeEventListener("pointerdown", resume)
      window.removeEventListener("keydown", resume)
      document.removeEventListener("visibilitychange", resume)
      try {
        source.stop()
      } catch {
        // already stopped
      }
      source.disconnect()
      gain.disconnect()
      void ctx.close().catch(() => {})
    }
  }, [enabled])
}
