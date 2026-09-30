"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WsContent } from "@platform/types";
import { useScreenWebSocket } from "@/hooks/useScreenWebSocket";
import {
  MEDIA_SEEK,
  MEDIA_SEEK_TO,
  MEDIA_SET_PAUSED,
  MEDIA_TOGGLE_PLAY,
  SET_PLAYBACK,
  PLAYBACK_SETTLE_MS,
  SCRUB_TRACK_INTERVAL_MS,
  type PlaybackState,
} from "@/lib/display/playback-protocol";
import { scrubFrameTime } from "@/lib/display/scrub-preview";

export interface ScreenPlayback {
  /** Seconds from the start, or 0 before the screen has reported anything. */
  time: number;
  /** Total seconds, or 0 when the screen has not reported a usable duration. */
  duration: number;
  playing: boolean;
  /** True once a position for the CURRENT content has actually arrived. */
  known: boolean;
  seekBy: (delta: number) => void;
  seekTo: (time: number) => void;
  togglePlay: () => void;
  /**
   * A scrub is a session, not a series of seeks: the screen pauses for its
   * duration, follows the finger, and resumes only if it had been playing.
   */
  beginScrub: () => void;
  /** Where the finger is now. Quantised and rate-limited before it goes out. */
  scrubTo: (time: number) => void;
  endScrub: (time: number) => void;
}

const noop = () => {};

/**
 * Real playback state for one screen, in the CMS.
 *
 * The comment this replaces claimed the CMS "cannot observe real playback
 * state, because SET_PLAYBACK fans out to the screen registry, never to CMS
 * sockets". The first half is right and the conclusion is wrong:
 * sendCommandToScreen (apps/api/src/ws/gateway.ts) sends to the WHOLE
 * screenRegistry for that screen, and a socket that registered with
 * preview:true is in it — `isPreview` only excludes it from
 * getConnectedScreenIds(), i.e. from the online COUNT. So the CMS can hold a
 * preview socket for one screen and see everything that screen is told and
 * reports, which is exactly what WhiteboardScreenBridge already does.
 *
 * That is why this needs no gateway change and no @platform/types change, and
 * why it is per-screen rather than a broadcast every CMS tab in the building
 * would have to filter. It also gets seeding for free: REGISTER replays the
 * cached view state to the joining socket, so the scrub bar is populated the
 * moment the panel opens rather than after the next timeupdate.
 *
 * Mutators go over this socket (sendInteraction) rather than through
 * sendRemoteCommand: that is a Next server action, Next serializes server
 * actions per client, and a scrub committing every 250ms would queue behind
 * itself and land the final seek seconds after the finger stopped.
 */
export function useScreenPlayback(
  screenId: string,
  /**
   * The video URL currently live on the screen. Playback for anything else is
   * ignored — the gateway's replay buffer is keyed by command name, not by
   * content, so a position left over from a previously-shown video would
   * otherwise paint this one's bar. Undefined means "not known yet", and the
   * guard FAILS CLOSED: nothing is accepted until a source is known, because
   * the alternative is showing a confidently wrong position.
   */
  source: string | undefined
): ScreenPlayback {
  const [state, setState] = useState<PlaybackState | null>(null);
  /** When the value in `state` was received, so the position can be advanced
   * between messages — the screen reports once a second, and a bar that only
   * moves once a second reads as broken rather than live. */
  const [receivedAt, setReceivedAt] = useState(0);
  /** Forces a re-render while playing so the interpolation below is redrawn. */
  const [, setTick] = useState(0);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  /** While set, inbound updates are ignored — see PLAYBACK_SETTLE_MS. */
  const settleUntilRef = useRef(0);
  /** The interpolated position this hook last returned, for seek arithmetic. */
  const displayTimeRef = useRef(0);
  /**
   * A drag is in progress. State rather than a ref because the returned
   * `playing` is masked while it is true, and a ref would not re-render.
   */
  const [scrubbing, setScrubbing] = useState(false);
  /** Whether playback should be restored when the drag ends. */
  const scrubResumeRef = useRef(false);
  /** Rate/frame gates for the tracking sends — see scrubTo. */
  const scrubLastSentRef = useRef(0);
  const scrubLastFrameRef = useRef<number | null>(null);

  // A source change is a different video; drop the old position rather than
  // showing it against the new one for a second.
  useEffect(() => {
    setState(null);
    settleUntilRef.current = 0;
  }, [source]);

  const onCommand = useCallback((command: string, value?: unknown) => {
    if (command !== SET_PLAYBACK) return;
    const next = value as PlaybackState | undefined;
    if (!next || typeof next.time !== "number") return;
    const live = sourceRef.current;
    if (!live || (next.src && next.src !== live)) return;
    if (Date.now() < settleUntilRef.current) return;
    setState(next);
    setReceivedAt(Date.now());
  }, []);

  const { sendInteraction } = useScreenWebSocket({
    screenId,
    onContentUpdate: noop as (content: WsContent) => void,
    onCommand,
    wsUrl: process.env["NEXT_PUBLIC_WS_GATEWAY_URL"] ?? "/ws/",
    preview: true,
  });

  // Redraw between messages so the position advances smoothly. Only while
  // playing — a paused video has nothing to interpolate.
  useEffect(() => {
    if (!state?.playing) return;
    const timer = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, [state?.playing]);

  /** Hold our own value authoritative briefly, and show it immediately. */
  const assume = useCallback((patch: Partial<PlaybackState>) => {
    settleUntilRef.current = Date.now() + PLAYBACK_SETTLE_MS;
    setReceivedAt(Date.now());
    setState((prev) =>
      prev ? { ...prev, ...patch } : { src: sourceRef.current ?? "", time: 0, playing: true, ...patch }
    );
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      // From the DISPLAYED position, not from state.time: the anchor can be up
      // to one report interval old, so seeding the optimistic value from it
      // would show the thumb landing ~1s short for the whole settle window.
      assume({ time: Math.max(0, displayTimeRef.current + delta) });
      sendInteraction(MEDIA_SEEK, { delta });
    },
    [assume, sendInteraction]
  );

  const seekTo = useCallback(
    (time: number) => {
      assume({ time });
      sendInteraction(MEDIA_SEEK_TO, { time });
    },
    [assume, sendInteraction]
  );

  const togglePlay = useCallback(() => {
    assume({ playing: !(state?.playing ?? true) });
    sendInteraction(MEDIA_TOGGLE_PLAY);
  }, [assume, sendInteraction, state?.playing]);

  // ─── Scrub session ────────────────────────────────────────────────────────

  const beginScrub = useCallback(() => {
    // Remember what to restore BEFORE pausing, because the pause we are about
    // to send comes straight back as playing:false and would otherwise
    // overwrite the very fact we need on release.
    scrubResumeRef.current = state?.playing ?? false;
    setScrubbing(true);
    scrubLastSentRef.current = 0;
    scrubLastFrameRef.current = null;
    sendInteraction(MEDIA_SET_PAUSED, { paused: true });
    // Deliberately NOT assume({ playing: false }). The video really does pause,
    // but that pause is a mechanism of scrubbing rather than something the
    // operator asked for, and surfacing it would flip the button to "Play" for
    // the length of the drag and back on release. The mask further down holds
    // the pre-drag value instead.
  }, [sendInteraction, state?.playing]);

  const scrubTo = useCallback(
    (time: number) => {
      assume({ time });
      // Two gates, and they do different jobs. The frame gate means dragging
      // within one second of the timeline sends nothing at all — the screen is
      // already showing that frame. The interval gate bounds a fast drag across
      // a long clip, where every pointer move does land on a new second.
      const frame = scrubFrameTime(time);
      if (frame === scrubLastFrameRef.current) return;
      const now = Date.now();
      if (now - scrubLastSentRef.current < SCRUB_TRACK_INTERVAL_MS) return;
      scrubLastFrameRef.current = frame;
      scrubLastSentRef.current = now;
      sendInteraction(MEDIA_SEEK_TO, { time: frame, scrubbing: true });
    },
    [assume, sendInteraction]
  );

  const endScrub = useCallback(
    (time: number) => {
      setScrubbing(false);
      assume({ time });
      // Exact, and without the scrubbing flag: this is the destination, so the
      // screen seeks precisely here and flushes it as the authoritative
      // position rather than rounding to the previewed second.
      sendInteraction(MEDIA_SEEK_TO, { time });
      if (scrubResumeRef.current) {
        sendInteraction(MEDIA_SET_PAUSED, { paused: false });
        assume({ playing: true });
      }
      scrubResumeRef.current = false;
    },
    [assume, sendInteraction]
  );

  const duration = Number.isFinite(state?.duration) ? (state?.duration ?? 0) : 0;
  // The reported position plus however long ago it was reported. Every inbound
  // message re-anchors it, so this can drift by at most one report interval and
  // is corrected a moment later — never accumulating.
  const elapsed = state?.playing && receivedAt > 0 ? (Date.now() - receivedAt) / 1000 : 0;
  const time = Math.max(0, (state?.time ?? 0) + elapsed);

  displayTimeRef.current = duration > 0 ? Math.min(time, duration) : time;

  return {
    time: displayTimeRef.current,
    duration,
    // Masked while dragging: the screen is genuinely paused for the scrub, but
    // reporting that would make the button flicker Pause → Play → Pause around
    // a gesture the operator thinks of as one action. Show what it will be when
    // they let go.
    playing: scrubbing ? scrubResumeRef.current : (state?.playing ?? false),
    known: state !== null,
    seekBy,
    seekTo,
    togglePlay,
    beginScrub,
    scrubTo,
    endScrub,
  };
}
