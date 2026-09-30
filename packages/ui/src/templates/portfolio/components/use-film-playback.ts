"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyPlayback,
  createPlaybackEmitter,
  scrubFrameTime,
  SCRUB_TRACK_INTERVAL_MS,
  type PlaybackState,
} from "../../../lib/playback-sync";
import {
  lastReplayableDetail,
  useReplayableWindowEvent,
} from "../../../lib/replayable-window-event";
import { usePortfolioScreen } from "../screen-context";

/**
 * Any client → every client of this screen. Absolute position and play state of
 * whatever video the portfolio currently has open.
 *
 * The SET_ prefix is load-bearing, not cosmetic: the gateway caches any SET_*
 * per screen AND per content and replays it when that content is pushed again
 * (viewStateCache in apps/api/src/ws/gateway.ts). That convention is the whole
 * reason re-pushing a portfolio experience resumes the film where it was left,
 * exactly as videos, PDFs and decks already do.
 *
 * ONE command for both video surfaces — the films player and the overview's
 * "Watch Video" popup. Only one of them is ever open at a time, and `src`
 * travels with the state and is checked on apply, so a second command name
 * would buy nothing but a second cache slot to keep in sync.
 */
export const SET_VIDEO_PLAYBACK = "SET_VIDEO_PLAYBACK";

/** Window event LiveScreenPlayer republishes the command above as. */
export const VIDEO_PLAYBACK_EVENT = "portfolio-video-playback";

/** Per-tap jump, matching the CMS transport and VideoControlsOverlay. */
export const SEEK_STEP_SECONDS = 10;

export interface FilmPlayback {
  /**
   * Attach to the <video> this drives: `ref={playback.videoRef}`.
   *
   * A CALLBACK ref, not a ref object, and that is the whole difference between
   * a working transport and a dead one. A ref object mutates silently, so
   * effects can only guess at when the element arrived by watching something
   * else — and the something else this watched was `src`, which does not
   * necessarily change when a <video> mounts. The films page keeps `index` at 0
   * while its grid is showing, so opening the FIRST film mounted an element
   * under an unchanged `src`: no listeners were ever attached to it, the bar sat
   * at 0:00 with a dead scrub bar, and nothing reported. Every other film
   * changed `src` and worked, which is exactly how the bug presented.
   */
  videoRef: (element: HTMLVideoElement | null) => void;
  /** The element currently attached, for a caller that needs it directly. */
  video: HTMLVideoElement | null;
  /** Seconds from the start. */
  time: number;
  /** Total seconds, or 0 before metadata lands. */
  duration: number;
  playing: boolean;
  togglePlay: () => void;
  seekBy: (delta: number) => void;
  /**
   * A scrub is a session, not a series of seeks: the picture holds still for
   * its duration and resumes only if it had been playing.
   */
  beginScrub: () => void;
  /** Where the finger is now. Quantised and rate-limited before it is applied. */
  scrubTo: (time: number) => void;
  endScrub: (time: number) => void;
}

/**
 * Playback for one portfolio video, synced across every client of the screen.
 *
 * Deliberately simpler than the CMS's own useScreenPlayback, and the difference
 * is worth stating: there, the operator's device holds no media at all, so it
 * has to model the screen's position optimistically and settle it against
 * inbound reports. Here EVERY client — the panel and the CMS mirror — has a
 * real <video> of the same file. So each one drives its own element immediately
 * and broadcasts the absolute result, and each one applies what it receives
 * through the same tolerance guard VideoRenderer uses. No optimism, no settle
 * window, and the button can never lie about what the element is doing.
 *
 * The gateway echoes to the sender, so everything here has to be idempotent:
 * applyPlayback seeks only past SEEK_TOLERANCE_SECONDS and only calls
 * play/pause when the state actually differs.
 */
export function useFilmPlayback(src: string | undefined): FilmPlayback {
  const { mirror } = usePortfolioScreen();

  // The element lives in BOTH a ref and state, deliberately. The ref is what
  // the transport callbacks read, so they stay stable and never go stale; the
  // state is what the effects below key on, so attaching or replacing the
  // element re-runs them.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    setVideoEl(element);
  }, []);

  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  /** Whether playback should be restored when the current drag ends. */
  const scrubResumeRef = useRef(false);
  /** True for the length of a drag — see the flush gate in the seeked handler. */
  const scrubbingRef = useRef(false);
  /** Rate/frame gates for the tracking seeks — see scrubTo. */
  const scrubLastSentRef = useRef(0);
  const scrubLastFrameRef = useRef<number | null>(null);

  const emitterRef = useRef<ReturnType<typeof createPlaybackEmitter> | null>(null);
  const srcRef = useRef(src);
  srcRef.current = src;
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;

  // ─── Outbound ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const emitter = createPlaybackEmitter((state) => {
      if (typeof window === "undefined") return;
      // Relayed by LiveScreenPlayer's `screen-control` listener as a
      // SCREEN_INTERACTION. Off the display route (the editor stage, the
      // preview tab) nothing is listening, which is exactly right — the same
      // way this template's navigation events already behave there.
      window.dispatchEvent(
        new CustomEvent("screen-control", { detail: { command: SET_VIDEO_PLAYBACK, value: state } })
      );
    });
    emitterRef.current = emitter;
    return () => {
      emitter.dispose();
      emitterRef.current = null;
    };
  }, []);

  const report = useCallback((immediate: boolean) => {
    const video = videoRef.current;
    const source = srcRef.current;
    if (!video || !source) return;
    // A mirror does not send the steady drip of position updates: it has no
    // authority over the timeline, and two clients reporting the same film a
    // second apart would have the gateway cache whichever landed last.
    //
    // Two things it DOES send. The discrete acts of a person, which arrive as
    // `immediate`. And the frames of a scrub in progress — an operator dragging
    // the bar in the CMS is steering, not observing, and without these the panel
    // would sit still until they let go. The emitter's own throttle keeps that
    // to about one message a second whatever the finger does.
    if (!immediate && mirrorRef.current && !scrubbingRef.current) return;
    const state: PlaybackState = { src: source, time: video.currentTime, playing: !video.paused };
    // Only when it is a real number. video.duration is NaN until metadata lands
    // and Infinity for some streams, and JSON.stringify turns NaN into null — a
    // value that passes an "is it undefined" check and then paints a scrub bar
    // with no scale.
    if (Number.isFinite(video.duration)) state.duration = video.duration;
    if (immediate) emitterRef.current?.flush(state);
    else emitterRef.current?.emit(state);
  }, []);

  // ─── Mirror the element ───────────────────────────────────────────────────
  //
  // The bar is a view of the video, not the owner of it, so a change made from
  // another client shows up here too. Reporting rides along on the same
  // listeners, which covers every path at once — the buttons below, an inbound
  // command, the clip ending.
  useEffect(() => {
    const video = videoEl;
    if (!video) return;

    const sync = () => {
      setTime(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setPlaying(!video.paused);
    };

    const onTimeUpdate = () => {
      sync();
      report(false);
    };
    const onDiscrete = () => {
      sync();
      report(true);
    };

    /**
     * Resume point, applied on metadata rather than on mount, for the two
     * reasons VideoRenderer applies its own one here: the element remounts on
     * every film change, and a seek issued before metadata exists is silently
     * discarded.
     *
     * It is read from the replay buffer rather than taken from the inbound
     * event, because that event has usually already been and gone — the gateway
     * replays it right after CONTENT_UPDATE, and on a mirror that joins while a
     * film is playing it arrives while this surface is still showing the grid
     * and owns no <video> at all. Without this the mirror would start the film
     * from zero, and if the panel happened to be PAUSED there would be no
     * further report to correct it.
     */
    let restored = false;
    const onLoadedMetadata = () => {
      sync();
      if (!restored) {
        restored = true;
        const resume = lastReplayableDetail<PlaybackState | null>(VIDEO_PLAYBACK_EVENT);
        if (resume && resume.src === srcRef.current) {
          // No report here: the seek and the play/pause it performs raise their
          // own events, which report the result exactly once.
          applyPlayback(video, resume);
          return;
        }
      }
      report(true);
    };
    // Flushed by default, because a seek is a discrete jump whose exact position
    // matters and timeupdate never fires while paused — except mid-drag, where
    // flushing every frame of the scrub is the broadcast storm the rate gate in
    // scrubTo exists to prevent.
    const onSeeked = () => {
      sync();
      report(!scrubbingRef.current);
    };

    sync();
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onDiscrete);
    video.addEventListener("pause", onDiscrete);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("seeked", onSeeked);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onDiscrete);
      video.removeEventListener("pause", onDiscrete);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [videoEl, report, src]);

  // ─── Autoplay ─────────────────────────────────────────────────────────────
  //
  // The `autoPlay` attribute cannot surface a blocked-playback promise
  // rejection — the element just sits frozen on its first frame with no error
  // anywhere. Calling play() explicitly lets the rejection be caught and retried
  // muted, so the film plays instead of staying dead. This is what unfreezes the
  // CMS mirror, where unmuted autoplay is blocked until someone gestures inside
  // that iframe. Same fallback VideoRenderer has.
  useEffect(() => {
    const video = videoEl;
    if (!video || !src) return;
    video.play().catch(() => {
      if (!video.muted) {
        video.muted = true;
        video.play().catch(() => {});
      }
    });
  }, [videoEl, src]);

  // ─── Inbound ──────────────────────────────────────────────────────────────

  useReplayableWindowEvent<PlaybackState | null | undefined>(VIDEO_PLAYBACK_EVENT, (state) => {
    const video = videoRef.current;
    if (!video || !state || typeof state.time !== "number") return;
    // The replay buffer is keyed by command name, not by content, so a position
    // left over from a previously-shown film would otherwise be applied to this
    // one. Also how a reset clears it — RESET_STATE dispatches null.
    if (state.src && state.src !== srcRef.current) return;
    applyPlayback(video, state);
  });

  // ─── Transport ────────────────────────────────────────────────────────────
  //
  // Every one of these drives the element directly. The play/pause/seeked
  // listeners above then report the result outward, so an action broadcasts
  // exactly once however it was triggered — locally or by an inbound command.

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = clampToDuration(video, video.currentTime + delta);
  }, []);

  const beginScrub = useCallback(() => {
    const video = videoRef.current;
    // Hold the picture still so the frame being aimed at stops moving out from
    // under the finger. Remembered BEFORE pausing, or the pause would overwrite
    // the very fact needed on release.
    scrubResumeRef.current = video ? !video.paused : false;
    scrubbingRef.current = true;
    scrubLastSentRef.current = 0;
    scrubLastFrameRef.current = null;
    video?.pause();
  }, []);

  const scrubTo = useCallback((t: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(t)) return;
    // Quantised to one frame per second of the timeline: dragging within the
    // same second re-seeks nothing, so a whole drag costs a bounded number of
    // seeks however wildly the finger moves. The exact position lands on
    // release, in endScrub.
    const frame = scrubFrameTime(clampToDuration(video, t));
    if (frame === scrubLastFrameRef.current) return;
    // The frame gate above bounds a slow drag; this bounds a fast one across a
    // long clip, where every pointer move does land on a new second.
    const now = Date.now();
    if (now - scrubLastSentRef.current < SCRUB_TRACK_INTERVAL_MS) return;
    scrubLastFrameRef.current = frame;
    scrubLastSentRef.current = now;
    video.currentTime = frame;
  }, []);

  const endScrub = useCallback((t: number) => {
    const video = videoRef.current;
    // Cleared before the seek below, so that seek reports as the destination it
    // is. Cleared unconditionally, so a drag ending abnormally (pointercancel, a
    // client disappearing) cannot leave reporting throttled forever.
    scrubbingRef.current = false;
    if (video && Number.isFinite(t)) {
      // Exact, not the previewed second — the drag is over, so land where the
      // finger actually stopped.
      video.currentTime = clampToDuration(video, t);
    }
    if (scrubResumeRef.current) {
      void video?.play().catch(() => {});
      scrubResumeRef.current = false;
    }
  }, []);

  return {
    videoRef: attachVideo,
    video: videoEl,
    time,
    duration,
    playing,
    togglePlay,
    seekBy,
    beginScrub,
    scrubTo,
    endScrub,
  };
}

/**
 * duration is NaN until metadata lands; fall back to an unclamped upper bound
 * rather than seeking to NaN, which silently resets the element to 0.
 */
function clampToDuration(video: HTMLVideoElement, t: number): number {
  const max = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
  return Math.min(Math.max(t, 0), max);
}
