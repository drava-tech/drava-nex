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

interface VideoRendererProps {
  content: VideoContent;
  /** True for any CMS-side embed of this screen (Screens control page, Live
   * Control popup, ...) — audio must only ever come out of the real TV, so
   * this always wins over the asset's own `muted` setting. */
  preview?: boolean;
}

export function VideoRenderer({ content, preview }: VideoRendererProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // A remote MUTE/UNMUTE command reaches every client of this screen,
    // including CMS-side mirrors — never let it unmute a preview, which must
    // always stay silent regardless of what the real TV is doing.
    if (preview) return;
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
  }, [preview]);

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
      applyPlayback(video, state);
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
  }, [content.source, preview]);

  // The `autoPlay` attribute below can't surface a blocked-playback promise
  // rejection — if the browser blocks unmuted autoplay (kiosk host missing
  // the --autoplay-policy flag, or any other viewer without it), the element
  // just sits frozen on its first frame with no error anywhere. This calls
  // play() explicitly so a rejection can be caught, falling back to muted
  // playback so the video still plays instead of staying dead. No "tap to
  // unmute" affordance: this is an unattended kiosk display, nobody's there
  // to click it (unlike welcome-renderer.tsx, which has a real click path).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => {
      if (!video.muted) {
        video.muted = true;
        video.play().catch(() => {});
      }
    });
  }, [content.source]);

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
      autoPlay
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
          applyPlayback(e.currentTarget, restore);
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
    {!preview && <VideoControlsOverlay videoRef={videoRef} />}
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
