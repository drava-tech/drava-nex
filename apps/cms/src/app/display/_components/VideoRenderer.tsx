"use client";

import { useEffect, useRef } from "react";
import { lastReplayableDetail } from "@platform/ui";
import type { VideoContent } from "@/types/display";
import {
  applyPlayback,
  createPlaybackEmitter,
  MEDIA_SEEK_EVENT,
  MEDIA_SEEK_TO_EVENT,
  MEDIA_SET_PAUSED_EVENT,
  MEDIA_TOGGLE_PLAY_EVENT,
  MEDIA_SET_PLAYBACK_EVENT,
  SET_PLAYBACK,
  type MediaSeekPayload,
  type MediaSeekToPayload,
  type MediaSetPausedPayload,
  type PlaybackState,
} from "@/lib/display/playback-protocol";
import { VideoControlsOverlay } from "./VideoControlsOverlay";

/**
 * How long to wait for a readiness event before starting playback anyway.
 * Deliberately longer than useContentPreloader's own 3s buffer budget, so in
 * the normal case the element is already warm and this never fires — it exists
 * only so a video that never reports ready still plays instead of freezing.
 */
const START_FALLBACK_MS = 4_000;

interface VideoRendererProps {
  content: VideoContent;
  /** True for any CMS-side embed of this screen (Screens control page, Live
   * Control popup, ...) — audio must only ever come out of the real TV, so
   * this always wins over the asset's own `muted` setting. */
  preview?: boolean;
  /**
   * Mounted, but parked below the bottom edge waiting to be pushed on screen.
   * Playback must not begin until the layer lands: starting at slide-start
   * would put the first 700ms of picture behind the bezel while the audio
   * played in full, which is exactly the audio-leads-picture failure the
   * readiness gate below exists to prevent. Slides in holding frame 0 instead.
   */
  staged?: boolean;
  /**
   * Sliding away and about to unmount. Emits nothing, obeys nothing, renders no
   * operator chrome — while two layers are mounted the gateway attributes every
   * SET_* to whatever content it believes is current, which is already the
   * INCOMING one, so a still-reporting outgoing element would overwrite the new
   * content's resume position on every video→video push.
   */
  outgoing?: boolean;
  /** Called once the first frame is decoded: this will paint the instant it is on screen. */
  onReady?: () => void;
}

export function VideoRenderer({ content, preview, staged, outgoing, onReady }: VideoRendererProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Initialised from the prop rather than defaulted, so the start effect below
  // reads the right value on its very first run — effects have not executed yet
  // at that point. Kept current by the companion effect after it.
  const stagedRef = useRef(!!staged);
  const maybeStartRef = useRef<() => void>(() => {});
  const readyFiredRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    // A remote MUTE/UNMUTE command reaches every client of this screen,
    // including CMS-side mirrors — never let it unmute a preview, which must
    // always stay silent regardless of what the real TV is doing. An outgoing
    // layer is one frame from unmounting and should not react at all.
    if (preview || outgoing) return;
    const handleMuteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ muted: boolean }>;
      if (videoRef.current) {
        videoRef.current.muted = customEvent.detail.muted;
      }
    };
    window.addEventListener("screen-mute", handleMuteEvent);
    return () => {
      window.removeEventListener("screen-mute", handleMuteEvent);
    };
  }, [preview, outgoing]);

  // ─── Playback transport ─────────────────────────────────────────────────
  //
  // Deliberately NOT gated on `preview`, unlike the mute effect above. That
  // guard exists because audio must only ever leave the real TV, which has no
  // equivalent here: every client of a screen should converge on the same
  // position, so seek/play/pause apply whether this is the TV or a CMS-side
  // embed. Only the outbound emit below is restricted to the authoritative
  // instance, so one screen reports one position.
  //
  // (This used to be justified by "the mirror is the operator's only visual
  // feedback". That stopped being true when the Screens panel replaced the
  // mirror with a controls-only panel for video — the reasoning above is the
  // one that still holds.)
  useEffect(() => {
    const source = content.source;
    if (!source) return;
    // On the commit where `outgoing` flips true React runs this effect's
    // previous cleanup — removing all nine listeners and disposing the emitter —
    // and then this no-op body, so a layer that is sliding out goes completely
    // silent on the wire. Muting it would not be enough: the timeupdate handler
    // below emits ~4x a second, and by transition time the gateway files those
    // under the incoming content's key.
    if (outgoing) return;

    const emitter = createPlaybackEmitter((state) => {
      // Relayed by LiveScreenPlayer's `screen-control` listener as a
      // SCREEN_INTERACTION, which the gateway caches under this content's key
      // and replays the next time this video is pushed.
      window.dispatchEvent(
        new CustomEvent("screen-control", { detail: { command: SET_PLAYBACK, value: state } })
      );
    });

    /**
     * True between the first scrubbing seek of a drag and the final plain one.
     *
     * The `seeked` listener below flushes by default, which is right for a
     * discrete seek and wrong for a drag — it would broadcast on every frame of
     * the scrub and undo the whole point of the `scrubbing` flag. Cleared by any
     * command that is not a scrub frame, so a drag that ends abnormally
     * (pointercancel, a client disappearing) cannot leave reporting throttled.
     */
    let scrubbing = false;

    /** Only the real TV reports position — a mirror echoing it too would have
     * the gateway cache two competing values for the same content. */
    const report = (immediate: boolean) => {
      const video = videoRef.current;
      if (!video || preview) return;
      const state: PlaybackState = { src: source, time: video.currentTime, playing: !video.paused };
      // Only when it is a real number. video.duration is NaN until metadata
      // lands and Infinity for some streams, and JSON.stringify turns NaN into
      // null — a value that passes an "is it undefined" check and then paints
      // a scrub bar with no scale.
      if (Number.isFinite(video.duration)) state.duration = video.duration;
      if (immediate) emitter.flush(state);
      else emitter.emit(state);
    };

    const onSeek = (e: Event) => {
      const video = videoRef.current;
      if (!video) return;
      const { delta } = ((e as CustomEvent<MediaSeekPayload>).detail ?? {}) as MediaSeekPayload;
      if (typeof delta !== "number") return;
      // duration is NaN until metadata lands; fall back to an unclamped upper
      // bound rather than seeking to NaN, which resets the element to 0.
      const max = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
      video.currentTime = Math.min(Math.max(video.currentTime + delta, 0), max);
      report(true);
    };

    const onSeekTo = (e: Event) => {
      const video = videoRef.current;
      if (!video) return;
      const payload = ((e as CustomEvent<MediaSeekToPayload>).detail ?? {}) as MediaSeekToPayload;
      const { time } = payload;
      if (typeof time !== "number" || !Number.isFinite(time)) return;

      scrubbing = payload.scrubbing === true;

      const max = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
      video.currentTime = Math.min(Math.max(time, 0), max);
      // A destination is flushed; a frame of a drag in progress is not. Flushing
      // would be right for a single seek — timeupdate never fires while paused,
      // so other clients would otherwise sit on the old position — but during a
      // live scrub it means a broadcast per seek, ~8 a second, to every client
      // of the screen. The final seek of a drag omits the flag and flushes the
      // position that actually matters.
      report(!scrubbing);
    };

    /** Absolute, unlike onTogglePlay — see MEDIA_SET_PAUSED in the protocol. */
    const onSetPaused = (e: Event) => {
      const video = videoRef.current;
      if (!video) return;
      const { paused } = ((e as CustomEvent<MediaSetPausedPayload>).detail ??
        {}) as MediaSetPausedPayload;
      if (typeof paused !== "boolean") return;
      // Ends any scrub: the drag is over, or someone else took control.
      scrubbing = false;
      if (paused) video.pause();
      else void video.play().catch(() => {});
      report(true);
    };

    const onTogglePlay = () => {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) void video.play().catch(() => {});
      else video.pause();
      report(true);
    };

    const onSetPlayback = (e: Event) => {
      const video = videoRef.current;
      const state = (e as CustomEvent<PlaybackState | undefined>).detail;
      if (!video || !state || typeof state.time !== "number") return;
      // The replay buffer is keyed by command name, not by content, so a
      // position left over from a previously-shown video would otherwise be
      // applied to this one.
      if (state.src && state.src !== source) return;
      // applyPlayback calls play() whenever the state says playing, which would
      // start this element while it is still parked below the bezel. The start
      // effect below owns when playback begins; position still applies.
      applyPlayback(video, stagedRef.current ? { ...state, playing: false } : state);
    };

    window.addEventListener(MEDIA_SEEK_EVENT, onSeek);
    window.addEventListener(MEDIA_SEEK_TO_EVENT, onSeekTo);
    window.addEventListener(MEDIA_SET_PAUSED_EVENT, onSetPaused);
    window.addEventListener(MEDIA_TOGGLE_PLAY_EVENT, onTogglePlay);
    window.addEventListener(MEDIA_SET_PLAYBACK_EVENT, onSetPlayback);

    const video = videoRef.current;
    const onTimeUpdate = () => report(false);
    const onPlay = () => report(true);
    const onPause = () => report(true);
    // Flushed, not throttled: a seek is a discrete jump whose exact position
    // matters, and timeupdate would report it up to a second late (and not at
    // all while paused). Covers every seek path at once — the on-screen scrub
    // bar, MEDIA_SEEK, MEDIA_SEEK_TO.
    //
    // Except mid-drag, where flushing every frame of the scrub is exactly the
    // broadcast storm the `scrubbing` flag exists to prevent — the flag would
    // be pointless if this listener flushed anyway.
    const onSeeked = () => report(!scrubbing);
    video?.addEventListener("timeupdate", onTimeUpdate);
    video?.addEventListener("play", onPlay);
    video?.addEventListener("pause", onPause);
    video?.addEventListener("seeked", onSeeked);

    return () => {
      window.removeEventListener(MEDIA_SEEK_EVENT, onSeek);
      window.removeEventListener(MEDIA_SEEK_TO_EVENT, onSeekTo);
      window.removeEventListener(MEDIA_SET_PAUSED_EVENT, onSetPaused);
      window.removeEventListener(MEDIA_TOGGLE_PLAY_EVENT, onTogglePlay);
      window.removeEventListener(MEDIA_SET_PLAYBACK_EVENT, onSetPlayback);
      video?.removeEventListener("timeupdate", onTimeUpdate);
      video?.removeEventListener("play", onPlay);
      video?.removeEventListener("pause", onPause);
      video?.removeEventListener("seeked", onSeeked);
      emitter.dispose();
    };
  }, [content.source, preview, outgoing]);

  // Playback is started here rather than by an `autoPlay` attribute, for two
  // reasons. First, `autoPlay` can't surface a blocked-playback promise
  // rejection — if the browser blocks unmuted autoplay (kiosk host missing
  // the --autoplay-policy flag, or any other viewer without it), the element
  // just sits frozen on its first frame with no error anywhere; calling play()
  // explicitly lets a rejection be caught and fall back to muted playback so
  // the video still plays instead of staying dead. No "tap to unmute"
  // affordance: this is an unattended kiosk display, nobody's there to click
  // it (unlike welcome-renderer.tsx, which has a real click path).
  //
  // Second, having BOTH `autoPlay` and this call issues two competing play
  // requests, and the browser treats the second as interrupting the first —
  // the "~1s-in stutter" already diagnosed and fixed in welcome-renderer.tsx
  // (see the comment on its <video>), which was never carried over here.
  //
  // The readiness gate matters just as much as which of the two starts it.
  // play() on a freshly-mounted element with an empty buffer starts the video
  // renderer as soon as the first frame decodes while the audio renderer is
  // still opening its output — so the picture runs, the sound arrives late,
  // and the audio then drops the samples it fell behind by to re-lock to the
  // clock (an audibly missing word). Waiting for HAVE_FUTURE_DATA lets both
  // renderers start together. Needs preload="auto" on the element below:
  // without `autoPlay` the browser would otherwise stop at metadata and
  // `canplay` would never fire.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    readyFiredRef.current = false;
    /** The original start gate: canplay | loadeddata | error | fallback timer. */
    let mediaReady = false;
    let started = false;

    /**
     * "This will paint the instant it is on screen", which is all the push
     * transition needs to start moving. Deliberately a LOWER bar than the
     * HAVE_FUTURE_DATA start gate below — one decoded frame is a picture, it
     * just isn't playable yet — and one-shot, so a re-render cannot re-fire it.
     */
    const signalReady = () => {
      if (readyFiredRef.current) return;
      readyFiredRef.current = true;
      onReadyRef.current?.();
    };

    // A rejection means the browser blocked unmuted playback (a viewer without
    // the kiosk's --autoplay-policy flag). Retry muted once so the video still
    // plays; if that fails too there is nothing further to try, and this is an
    // unattended panel with nobody there to tap.
    const start = () => {
      video.play().catch(() => {
        if (!video.muted) {
          video.muted = true;
          video.play().catch(() => {});
        }
      });
    };

    // Both conditions, in either order: the media has to be playable AND the
    // layer has to be on screen. Whichever lands second calls this — the media
    // side from the listeners below, the layer side from the `staged` effect.
    const maybeStart = () => {
      if (started || !mediaReady || stagedRef.current) return;
      started = true;
      start();
    };
    maybeStartRef.current = maybeStart;

    // A cached asset can already hold a decoded frame at mount. Report it now
    // rather than waiting on an event that has already fired.
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) signalReady();

    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      mediaReady = true;
      maybeStart();
      return;
    }

    // The readiness gate must never be the ONLY way playback can begin. Without
    // `autoPlay` nothing forces the browser past metadata — `preload="auto"` is
    // a hint Chromium is free to ignore under memory pressure or on a signage
    // appliance — and a mid-load network error fires `error`, not `canplay`. In
    // either case a bare `canplay` listener leaves the panel frozen on a black
    // first frame with nothing in the logs, which is exactly what a stalled
    // publish looked like on the wall. So: take whichever signal arrives first,
    // and fall back to starting unconditionally rather than showing nothing.
    //
    // The fallback timer now guarantees readiness; it never bypasses `staged`.
    // That cannot stall, because the transition's own ready timeout and hard
    // stop clear `staged` whether or not this element ever reports anything.
    let done = false;
    const readyEnough = () => {
      if (done) return;
      done = true;
      cleanup();
      mediaReady = true;
      signalReady();
      maybeStart();
    };
    const timer = setTimeout(readyEnough, START_FALLBACK_MS);
    function cleanup() {
      clearTimeout(timer);
      video?.removeEventListener("canplay", readyEnough);
      video?.removeEventListener("loadeddata", readyEnough);
      video?.removeEventListener("error", readyEnough);
    }
    video.addEventListener("canplay", readyEnough, { once: true });
    video.addEventListener("loadeddata", readyEnough, { once: true });
    video.addEventListener("error", readyEnough, { once: true });
    return cleanup;
  }, [content.source]);

  // Declared after the start effect so maybeStartRef is populated by the time
  // this first runs. Deps stay off the effect above on purpose: re-running it
  // would reset `started` and could restart an element the operator paused.
  useEffect(() => {
    stagedRef.current = !!staged;
    if (!staged) maybeStartRef.current();
  }, [staged]);

  // Declared LAST so it runs after the transport effect's cleanup has removed
  // the `pause` listener — otherwise this pause would emit the very SET_PLAYBACK
  // that disabling the transport effect exists to prevent. Frees the hardware
  // decoder for the incoming layer while leaving the last frame painted, which
  // is what keeps a video→video push to one live decode on a signage appliance.
  useEffect(() => {
    if (outgoing) videoRef.current?.pause();
  }, [outgoing]);

  if (!content.source) {
    return (
      <ErrorOverlay message="Video source is missing from the content configuration." />
    );
  }

  return (
    <>
    <video
      ref={videoRef}
      key={content.source}       // force remount if source changes
      src={content.source}
      // No `autoPlay`: the effect above starts playback once the element is
      // actually ready. preload="auto" is what makes that safe — see there.
      preload="auto"
      playsInline
      muted={preview || content.muted}
      loop={content.loop}
      onLoadedMetadata={(e) => {
        // Resume point, applied here rather than on mount: the element
        // remounts on every source change (key above) and seeking before
        // metadata exists is silently discarded. The value comes from the
        // replay buffer because the gateway sends it immediately after
        // CONTENT_UPDATE — well before this element existed.
        const restore = lastReplayableDetail(MEDIA_SET_PLAYBACK_EVENT) as PlaybackState | undefined;
        if (restore && restore.src === content.source) {
          // playing is neutralised while staged: applyPlayback calls play() on a
          // restored playing:true, which would start this element below the
          // bezel and leak its audio ahead of the picture. Position is restored
          // either way, so resume-on-re-push is unaffected.
          applyPlayback(
            e.currentTarget,
            stagedRef.current ? { ...restore, playing: false } : restore
          );
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        // "contain", not "cover": cover crops AND upscales anything whose
        // aspect ratio isn't the panel's, and the library holds portrait
        // (720x900) and off-ratio (1820x1008) clips. On a 16:9 panel cover
        // scaled those past 5x and threw most of the frame away — the reason
        // video looked soft on the 86" screen. Letterboxing on the black
        // ground below never enlarges beyond what fits.
        objectFit: "contain",
        backgroundColor: "#000",
        display: "block",
      }}
    />
    {/* Only on the real panel. A CMS-side embed has no operator standing at
        it, and ScreenMirror makes its iframe pointer-events:none anyway. */}
    {!preview && !outgoing && <VideoControlsOverlay videoRef={videoRef} />}
    </>
  );
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function ErrorOverlay({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100vw",
        height: "100vh",
        backgroundColor: "#0a0a0a",
        color: "#ef4444",
        fontFamily: "system-ui, sans-serif",
        fontSize: "1.25rem",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      {message}
    </div>
  );
}
