"use client";

import { useEffect, useRef } from "react";
import { lastReplayableDetail } from "@platform/ui";
import type { VideoContent } from "@/types/display";
import {
  createPlaybackEmitter,
  MEDIA_SEEK_EVENT,
  MEDIA_TOGGLE_PLAY_EVENT,
  MEDIA_SET_PLAYBACK_EVENT,
  SET_PLAYBACK,
  SEEK_TOLERANCE_SECONDS,
  type MediaSeekPayload,
  type PlaybackState,
} from "@/lib/display/playback-protocol";

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
  // guard exists because audio must only ever leave the real TV; a mirror
  // that stays in step is the entire point of a mirror, and for a native
  // video the mirror is the operator's only visual feedback (a video is
  // content.type "video", which useScreenControls shows the mirror for rather
  // than the touchpad). So seek/play/pause apply here either way — only the
  // outbound emit below is restricted to the authoritative instance.
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

    /** Only the real TV reports position — a mirror echoing it too would have
     * the gateway cache two competing values for the same content. */
    const report = (immediate: boolean) => {
      const video = videoRef.current;
      if (!video || preview) return;
      const state: PlaybackState = { src: source, time: video.currentTime, playing: !video.paused };
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
    window.addEventListener(MEDIA_TOGGLE_PLAY_EVENT, onTogglePlay);
    window.addEventListener(MEDIA_SET_PLAYBACK_EVENT, onSetPlayback);

    const video = videoRef.current;
    const onTimeUpdate = () => report(false);
    const onPlay = () => report(true);
    const onPause = () => report(true);
    video?.addEventListener("timeupdate", onTimeUpdate);
    video?.addEventListener("play", onPlay);
    video?.addEventListener("pause", onPause);

    return () => {
      window.removeEventListener(MEDIA_SEEK_EVENT, onSeek);
      window.removeEventListener(MEDIA_TOGGLE_PLAY_EVENT, onTogglePlay);
      window.removeEventListener(MEDIA_SET_PLAYBACK_EVENT, onSetPlayback);
      video?.removeEventListener("timeupdate", onTimeUpdate);
      video?.removeEventListener("play", onPlay);
      video?.removeEventListener("pause", onPause);
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
        objectFit: "cover",
        backgroundColor: "#000",
        display: "block",
      }}
    />
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Apply an absolute playback state. Seeks only when the gap is real: the
 * gateway echoes a SET_PLAYBACK back to the very screen that sent it, so
 * assigning currentTime unconditionally would fight the element's own
 * playback about once a second and stutter the picture.
 */
function applyPlayback(video: HTMLVideoElement, state: PlaybackState) {
  if (Number.isFinite(state.time) && Math.abs(video.currentTime - state.time) > SEEK_TOLERANCE_SECONDS) {
    video.currentTime = state.time;
  }
  if (state.playing && video.paused) void video.play().catch(() => {});
  else if (!state.playing && !video.paused) video.pause();
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
