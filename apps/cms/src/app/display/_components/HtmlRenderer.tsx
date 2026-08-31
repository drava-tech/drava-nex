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

interface YTPlayer {
  unMute(): void;
  setVolume(volume: number): void;
  setPlaybackQuality(suggestedQuality: string): void;
  destroy(): void;
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: { events?: { onReady?: (e: { target: YTPlayer }) => void } }) => YTPlayer };
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
}: {
  content: HtmlContent;
  /** True for any CMS-side embed of this screen — never delegate the
   * autoplay permission here, so an embedded YouTube/Vimeo/SoundCloud/etc.
   * player can't produce sound in the CMS, only on the real TV. */
  preview?: boolean;
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

  useEffect(() => {
    if (!isKioskYouTube) return;
    let cancelled = false;
    let player: YTPlayer | undefined;

    const createPlayer = () => {
      if (cancelled || !iframeRef.current || !window.YT) return;
      player = new window.YT.Player(iframeRef.current, {
        events: {
          onReady: (e) => {
            e.target.unMute();
            e.target.setVolume(100);
            try {
              e.target.setPlaybackQuality("hd1080");
            } catch {}
          },
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
      player?.destroy();
    };
  }, [isKioskYouTube, content.source]);

  // The display page pins `touch-action: none` on html/body so signage can't be
  // panned or pinch-zoomed by a passer-by. Touch-action is intersected down the
  // ancestor chain and that chain crosses into the frame, so leaving it set
  // would mean a touch screen could tap inside an embedded page but never
  // scroll it. Relaxed only while a page is on screen, and put back on unmount
  // so image/video content keeps the gesture lock it wants.
  useEffect(() => {
    const { style } = document.documentElement;
    const bodyStyle = document.body.style;
    const previous = { root: style.touchAction, body: bodyStyle.touchAction };

    style.touchAction = "auto";
    bodyStyle.touchAction = "auto";

    return () => {
      style.touchAction = previous.root;
      bodyStyle.touchAction = previous.body;
    };
  }, []);

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
  }, [content.source, preview]);

  return (
    <iframe
      key={content.source}
      ref={iframeRef}
      src={content.source}
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
