"use client";

import { useEffect, useRef } from "react";
import { PDF_VIEWER_PATH, SLIDES_VIEWER_PATH } from "@platform/types";
import { lastReplayableDetail } from "@platform/ui";
import type { HtmlContent } from "@/types/display";
import {
  FRAME_BRIDGE_SOURCE,
  FRAME_FORWARDED_COMMANDS,
  frameCommandEvent,
  isBridgeMessage,
  type FrameBridgeMessage,
} from "@/lib/display/frame-bridge";
import {
  createPlaybackEmitter,
  MEDIA_SEEK_EVENT,
  MEDIA_TOGGLE_PLAY_EVENT,
  MEDIA_SET_PLAYBACK_EVENT,
  SET_PLAYBACK,
  SEEK_TOLERANCE_SECONDS,
  PLAYBACK_EMIT_THROTTLE_MS,
  type MediaSeekPayload,
  type PlaybackState,
} from "@/lib/display/playback-protocol";

interface YTPlayer {
  unMute(): void;
  setVolume(volume: number): void;
  setPlaybackQuality(suggestedQuality: string): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  /** YT.PlayerState — 1 is PLAYING, which is the only value this cares about. */
  getPlayerState(): number;
  destroy(): void;
}

/** YT.PlayerState.PLAYING. Not worth pulling in the whole enum for one check. */
const YT_STATE_PLAYING = 1;

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          events?: {
            onReady?: (e: { target: YTPlayer }) => void;
            onStateChange?: (e: { data: number; target: YTPlayer }) => void;
          };
        }
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_API_SCRIPT_ID = "youtube-iframe-api";

/**
 * Full-screen embedded page. Backs every media kind that isn't natively
 * playable — PDFs, spreadsheets, YouTube, Drive and arbitrary web pages — via
 * the embed URL built by mediaEmbedUrl() in @platform/types.
 *
 * The `allow` list matters: a cross-origin embed only gets autoplay if the
 * parent page delegates it, and without that a kiosk YouTube embed just sits on
 * its first frame. `preview` deliberately withholds that delegation — audio
 * must only ever come out of the real TV, never a CMS-side mirror — which
 * blocks audible autoplay for any provider uniformly (muted/silent autoplay,
 * i.e. the visual motion, is still allowed either way).
 *
 * The sandbox grants what an interactive page needs (forms, modals, downloads),
 * because a touch screen showing a web page has to be usable — the same set the
 * CMS preview grants, so what was approved there behaves identically here.
 */
export function HtmlRenderer({
  content,
  preview,
  outgoing,
  onReady,
}: {
  content: HtmlContent;
  /** True for any CMS-side embed of this screen — never delegate the
   * autoplay permission here, so an embedded YouTube/Vimeo/SoundCloud/etc.
   * player can't produce sound in the CMS, only on the real TV. */
  preview?: boolean;
  /** Sliding away and about to unmount: emit nothing, relay nothing. See
   * VideoRenderer.tsx — the kiosk YouTube poll below has the same problem of
   * reporting a position the gateway files under the incoming content. */
  outgoing?: boolean;
  /**
   * The embedded document has loaded.
   *
   * Honest limitation: for the same-origin /display/pdf and /display/slides
   * viewers this fires when the viewer document loads, not when page one has
   * rendered, so a deck lands a beat before it paints. The frame bridge's own
   * `ready` message is posted at connect time and so is no better. Tightening
   * it means posting `ready` after first render inside PdfViewer/SlidesViewer.
   */
  onReady?: () => void;
}) {
  // Slides and PDF must NOT get the +20px overhang: an iframe's CSS width is
  // that document's own viewport width, so the extra 20px gets scaled into the
  // content itself and then cropped off the right edge by this page's own
  // `overflow:hidden` ([screenId]/page.tsx). Slides is a ResizeObserver-driven
  // exact-fit renderer that grows no scrollbar at all;
  // PDF does scroll continuously, but hides its own scrollbar in CSS
  // (`.pdf-scroll` in PdfViewer), so neither needs a bar pushed off-screen —
  // unlike Sheet/Word below, which scroll with the browser's native bar.
  const isExactFitViewer =
    content.source.startsWith(SLIDES_VIEWER_PATH) || content.source.startsWith(PDF_VIEWER_PATH);

  // mediaEmbedUrl() starts a kiosk YouTube embed muted (see the comment
  // there) so autoplay is deterministic instead of YouTube's own player
  // silently retrying an unmuted attempt. This unmutes it for real once the
  // IFrame Player API reports the player ready, and asks (best-effort —
  // YouTube stopped reliably honoring forced quality for most embeds years
  // ago, so this is a hint, not a guarantee) for a higher starting quality
  // than the player's own conservative-then-ramp-up default, which a looping
  // clip may never climb out of between restarts.
  const isKioskYouTube = !preview && /^https:\/\/www\.youtube\.com\/embed\//.test(content.source);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** Hoisted out of the effect closure so the transport listeners below can
   * reach the player — the whole reason YouTube was previously uncontrollable. */
  const playerRef = useRef<YTPlayer | null>(null);
  /** Set by the transport effect below; read from onStateChange, which is
   * registered first. Declared here so both effects can see it. */
  const emitPlaybackRef = useRef<((immediate: boolean) => void) | null>(null);

  useEffect(() => {
    if (!isKioskYouTube) return;
    let cancelled = false;
    let player: YTPlayer | undefined;

    const createPlayer = () => {
      if (cancelled || !iframeRef.current || !window.YT) return;
      player = new window.YT.Player(iframeRef.current, {
        events: {
          onReady: (e) => {
            playerRef.current = e.target;
            e.target.unMute();
            e.target.setVolume(100);
            try {
              e.target.setPlaybackQuality("hd1080");
            } catch {}
            // Resume where this video was left off, if the gateway replayed a
            // position while the IFrame API was still loading. Buffered
            // because that replay lands right after CONTENT_UPDATE, long
            // before the player exists.
            const restore = lastReplayableDetail(MEDIA_SET_PLAYBACK_EVENT) as PlaybackState | undefined;
            if (restore && restore.src === content.source && Number.isFinite(restore.time)) {
              e.target.seekTo(restore.time, true);
              if (!restore.playing) e.target.pauseVideo();
            }
          },
          // Fires on every play/pause/buffer/end, which is the only signal the
          // IFrame API gives — there is no timeupdate equivalent.
          onStateChange: () => emitPlaybackRef.current?.(true),
        },
      });
    };

    if (window.YT?.Player) {
      createPlayer();
    } else {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        createPlayer();
      };
      if (!document.getElementById(YT_API_SCRIPT_ID)) {
        const script = document.createElement("script");
        script.id = YT_API_SCRIPT_ID;
        script.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      playerRef.current = null;
      player?.destroy();
    };
  }, [isKioskYouTube, content.source]);

  // ─── Playback transport (kiosk YouTube) ───────────────────────────────────
  //
  // Only the real TV ever has a player: isKioskYouTube is `!preview`, and a
  // YouTube asset shows the CMS operator the OS-cursor touchpad rather than a
  // mirror (useScreenControls keys off content.type === "html"), so there is
  // no preview player to keep in step.
  useEffect(() => {
    if (!isKioskYouTube) return;
    // The YT player itself is deliberately NOT torn down when this goes
    // outgoing (that effect is untouched) — destroying it blanks the iframe
    // mid-slide. Only the reporting stops.
    if (outgoing) return;
    const source = content.source;

    const emitter = createPlaybackEmitter((state) => {
      window.dispatchEvent(
        new CustomEvent("screen-control", { detail: { command: SET_PLAYBACK, value: state } })
      );
    });

    const report = (immediate: boolean) => {
      const player = playerRef.current;
      if (!player) return;
      let time: number;
      let playing: boolean;
      try {
        time = player.getCurrentTime();
        playing = player.getPlayerState() === YT_STATE_PLAYING;
      } catch {
        // The player can be mid-teardown or not yet fully initialised; a
        // missed position report is not worth surfacing.
        return;
      }
      if (!Number.isFinite(time)) return;
      // A paused player's position doesn't change, so the poll has nothing to
      // report — only discrete actions (which flush) matter once stopped.
      if (!immediate && !playing) return;
      const state: PlaybackState = { src: source, time, playing };
      if (immediate) emitter.flush(state);
      else emitter.emit(state);
    };
    emitPlaybackRef.current = report;

    const onSeek = (e: Event) => {
      const player = playerRef.current;
      if (!player) return;
      const { delta } = ((e as CustomEvent<MediaSeekPayload>).detail ?? {}) as MediaSeekPayload;
      if (typeof delta !== "number") return;
      try {
        player.seekTo(Math.max(player.getCurrentTime() + delta, 0), true);
      } catch {
        return;
      }
      report(true);
    };

    const onTogglePlay = () => {
      const player = playerRef.current;
      if (!player) return;
      try {
        if (player.getPlayerState() === YT_STATE_PLAYING) player.pauseVideo();
        else player.playVideo();
      } catch {
        return;
      }
      report(true);
    };

    const onSetPlayback = (e: Event) => {
      const player = playerRef.current;
      const state = (e as CustomEvent<PlaybackState | undefined>).detail;
      if (!player || !state || !Number.isFinite(state.time)) return;
      // The replay buffer is keyed by command name, not content — a position
      // from a previously-shown video must not be applied to this one.
      if (state.src && state.src !== source) return;
      try {
        // Tolerance, because the gateway echoes our own reports back to us;
        // seeking on every echo would stutter playback about once a second.
        if (Math.abs(player.getCurrentTime() - state.time) > SEEK_TOLERANCE_SECONDS) {
          player.seekTo(state.time, true);
        }
        const playing = player.getPlayerState() === YT_STATE_PLAYING;
        if (state.playing && !playing) player.playVideo();
        else if (!state.playing && playing) player.pauseVideo();
      } catch {
        /* player not ready */
      }
    };

    window.addEventListener(MEDIA_SEEK_EVENT, onSeek);
    window.addEventListener(MEDIA_TOGGLE_PLAY_EVENT, onTogglePlay);
    window.addEventListener(MEDIA_SET_PLAYBACK_EVENT, onSetPlayback);
    // The IFrame API has no timeupdate, so position is kept current by poll.
    // onStateChange alone would leave the cache stale between play and pause,
    // which is exactly the case that has to resume correctly.
    const poll = setInterval(() => report(false), PLAYBACK_EMIT_THROTTLE_MS);

    return () => {
      window.removeEventListener(MEDIA_SEEK_EVENT, onSeek);
      window.removeEventListener(MEDIA_TOGGLE_PLAY_EVENT, onTogglePlay);
      window.removeEventListener(MEDIA_SET_PLAYBACK_EVENT, onSetPlayback);
      clearInterval(poll);
      emitPlaybackRef.current = null;
      emitter.dispose();
    };
  }, [isKioskYouTube, content.source, outgoing]);

  // NOTE: the html/body `touch-action` relaxation this renderer used to own now
  // lives in LiveScreenPlayer, derived from the active content type. Saving on
  // mount and restoring on unmount broke once two layers could be mounted at
  // once: on an html → html push the incoming frame saved the outgoing frame's
  // "auto", then the outgoing unmounted 700ms later and restored "none" — over
  // an html page that was by then on screen, i.e. a pushed PDF or sheet that
  // could no longer be scrolled by touch.

  // Relay remote commands into a framed viewer. The display page owns the one
  // WebSocket, but a viewer runs in its own JS realm inside this iframe, so
  // LiveScreenPlayer's window events can't reach it — see frame-bridge.ts.
  //
  // Two races, each with the tool that actually solves it: the parent-side one
  // (a command arriving before this component mounted) is covered by
  // dispatchReplayableEvent's buffer, which works because that's the same
  // realm; the child-side one (iframe not loaded yet) is covered by the ready
  // handshake and queue below, because that buffer is per-realm and provably
  // cannot cross the frame boundary.
  const bridgeReadyRef = useRef(false);
  const bridgeQueueRef = useRef<{ command: string; value?: unknown }[]>([]);

  useEffect(() => {
    bridgeReadyRef.current = false;
    bridgeQueueRef.current = [];
    // A layer on its way off screen must not be paged: NEXT_PAGE reaches every
    // mounted renderer, and relaying it here would advance the outgoing deck
    // one slide as it slides away — and, worse, report that position back.
    if (outgoing) return;

    const post = (msg: FrameBridgeMessage) => {
      iframeRef.current?.contentWindow?.postMessage(msg, window.location.origin);
    };

    const sendCommand = (command: string, value?: unknown) => {
      if (bridgeReadyRef.current) {
        post({ source: FRAME_BRIDGE_SOURCE, kind: "command", command, value });
        return;
      }
      // Mirror the gateway's own one-slot-per-command semantics: a newer
      // absolute SET_* supersedes an older queued one, while everything
      // else keeps its relative order.
      if (command.startsWith("SET_")) {
        bridgeQueueRef.current = bridgeQueueRef.current.filter((q) => q.command !== command);
      }
      bridgeQueueRef.current.push({ command, value });
    };

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (!isBridgeMessage(e.data)) return;

      if (e.data.kind === "ready") {
        // A second "ready" means the frame reloaded itself — re-init and
        // reflush rather than treating it as a duplicate.
        bridgeReadyRef.current = true;
        post({ source: FRAME_BRIDGE_SOURCE, kind: "init", preview: !!preview });
        const queued = bridgeQueueRef.current;
        bridgeQueueRef.current = [];
        for (const q of queued) {
          post({ source: FRAME_BRIDGE_SOURCE, kind: "command", command: q.command, value: q.value });
        }
      } else if (e.data.kind === "control") {
        // Outbound: re-dispatch as the event LiveScreenPlayer already relays.
        window.dispatchEvent(
          new CustomEvent("screen-control", { detail: { command: e.data.command, value: e.data.value } })
        );
      }
    };

    window.addEventListener("message", onMessage);

    const unsubscribes = FRAME_FORWARDED_COMMANDS.map((command) => {
      const eventName = frameCommandEvent(command);
      const buffered = lastReplayableDetail(eventName);
      if (buffered !== undefined) sendCommand(command, buffered);
      const onEvent = (e: Event) => sendCommand(command, (e as CustomEvent).detail);
      window.addEventListener(eventName, onEvent);
      return () => window.removeEventListener(eventName, onEvent);
    });

    return () => {
      window.removeEventListener("message", onMessage);
      for (const off of unsubscribes) off();
    };
  }, [content.source, preview, outgoing]);

  return (
    <iframe
      key={content.source}
      ref={iframeRef}
      src={content.source}
      onLoad={onReady}
      onError={onReady}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        // A few px wider than the viewport: many pushed pages are taller than
        // one screen and grow their own native scrollbar, which otherwise
        // shows up as a bare strip (the iframe's background) on the right
        // edge. Overhanging the extra width pushes that scrollbar off-screen,
        // where the display page's own `overflow:hidden` (see html/body style
        // in [screenId]/page.tsx) clips it away. Skipped for the exact-fit
        // viewers — see `isExactFitViewer` above.
        width: isExactFitViewer ? "100vw" : "calc(100vw + 20px)",
        height: "100vh",
        border: "none",
        backgroundColor: "#000",
        display: "block",
        touchAction: "auto",
      }}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation"
      allow={preview ? "encrypted-media; fullscreen; clipboard-write" : "autoplay; encrypted-media; fullscreen; clipboard-write"}
    />
  );
}
