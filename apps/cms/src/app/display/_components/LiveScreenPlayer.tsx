"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IDLE_WS_CONTENT } from "@platform/types";
import type { WsContent } from "@platform/types";
import { cn, dispatchReplayableEvent } from "@platform/ui";
import { SET_VIDEO_PLAYBACK, VIDEO_PLAYBACK_EVENT } from "@platform/ui/templates/portfolio";
import { DATA_ART_VIEW_COMMAND, DATA_ART_VIEW_EVENT } from "@platform/ui/templates/drava-mosaic";
import type { Content } from "@/types/display";
import { useScreenWebSocket } from "@/hooks/useScreenWebSocket";
import { useContentPreloader } from "@/hooks/useContentPreloader";
import { useContentTransition, type ContentLayer } from "@/hooks/useContentTransition";
import { useAudioKeepAlive } from "@/hooks/useAudioKeepAlive";
import { isPushTransitionEnabled } from "@/lib/display/transition-config";
import { frameCommandEvent, isFrameForwardedCommand } from "@/lib/display/frame-bridge";
import {
  MEDIA_SEEK,
  MEDIA_SEEK_TO,
  MEDIA_SET_PAUSED,
  MEDIA_TOGGLE_PLAY,
  SET_PLAYBACK,
  MEDIA_SEEK_EVENT,
  MEDIA_SEEK_TO_EVENT,
  MEDIA_SET_PAUSED_EVENT,
  MEDIA_TOGGLE_PLAY_EVENT,
  MEDIA_SET_PLAYBACK_EVENT,
} from "@/lib/display/playback-protocol";
// ponytail: browser-based detection is disconnected — cameras are now
// host-native on the GPU box (services/vision). The hook + @platform/vision-browser
// are left in place; re-enable the call below to restore browser detection.
import { SCREEN_TO_CAMERA } from "@/lib/display/camera-config";
import { DetectionDebugOverlay } from "./DetectionDebugOverlay";
import { ContentRenderer } from "./ContentRenderer";
import { WhiteboardScreenOverlay } from "./WhiteboardScreenOverlay";
import { BlackoutOverlay } from "./BlackoutOverlay";
import { FiveTapCorner } from "./FiveTapCorner";
import { IdleDisplay } from "./IdleDisplay";
import {
  WHITEBOARD_START,
  WHITEBOARD_STOP,
  WHITEBOARD_SYNC,
  WHITEBOARD_SURFACE,
  WHITEBOARD_SET_STYLE,
  WHITEBOARD_STROKE_BEGIN,
  WHITEBOARD_STROKE_POINT,
  WHITEBOARD_STROKE_END,
  WHITEBOARD_UNDO,
  WHITEBOARD_CLEAR,
} from "@/lib/whiteboard-protocol";

interface LiveScreenPlayerProps {
  screenId: string;
  initialContent: Content | null;
  wsUrl: string;
  /** Registers as a preview mirror (CMS embed): excluded from the online count. */
  preview?: boolean;
}

function toWsContent(c: Content): WsContent {
  const base = { id: c.id, type: c.type as WsContent["type"], source: (c as { source?: string }).source ?? "" };
  if (c.type === "video") return { ...base, loop: c.loop, muted: c.muted };
  if (c.type === "experience")
    return { ...base, title: c.title, templateKey: c.templateKey, templateContent: c.templateContent };
  return base;
}

function toDisplayContent(ws: WsContent): Content {
  switch (ws.type) {
    case "video":
      // Only the idle/default-fallback video explicitly asks to stay silent
      // (packages/db/src/queries/screens.ts) — anything pushed to a screen
      // on purpose (assignMedia) carries no `muted` at all, so it should
      // default to playing with audio, not silently.
      return { id: ws.id, type: "video", source: ws.source, loop: ws.loop ?? true, muted: ws.muted ?? false };
    case "image":
      return { id: ws.id, type: "image", source: ws.source };
    case "html":
      return { id: ws.id, type: "html", source: ws.source };
    case "stream":
      return { id: ws.id, type: "stream", source: ws.source, muted: ws.muted ?? true };
    case "experience":
      return {
        id: ws.id,
        type: "experience",
        title: ws.title,
        templateKey: ws.templateKey,
        templateContent: ws.templateContent,
      };
    default:
      return { id: ws.id, type: "experience", title: undefined };
  }
}

export function LiveScreenPlayer({
  screenId,
  initialContent,
  wsUrl,
  preview = false,
}: LiveScreenPlayerProps) {
  const initial = initialContent ? toWsContent(initialContent) : IDLE_WS_CONTENT;
  const { activeContent, activeKey, queueContent } = useContentPreloader(initial);

  // Keeps the panel's audio output open across content swaps so no push — and
  // no pause -> play — has to wait for the HDMI sink to wake. Mounted here
  // rather than in a renderer precisely because it has to outlive every
  // content change. Never on a CMS mirror, same contract as the mute effect in
  // VideoRenderer.tsx.
  useAudioKeepAlive(!preview);

  // "Stop" must actually stop everything (video/audio/animations), not just
  // hide it behind BlackoutOverlay's black div — a hidden-but-still-mounted
  // <video> keeps playing its sound underneath. Unmounting ContentRenderer
  // is the one thing that reliably stops every content type's playback.
  const [blanked, setBlanked] = useState(false);
  useEffect(() => {
    const onBlank = () => setBlanked(true);
    const onUnblank = () => setBlanked(false);
    window.addEventListener("screen-blank", onBlank);
    window.addEventListener("screen-unblank", onUnblank);
    return () => {
      window.removeEventListener("screen-blank", onBlank);
      window.removeEventListener("screen-unblank", onUnblank);
    };
  }, []);

  // Whether this panel animates at all is a property of the installation, not
  // of a push — read once. See transition-config.ts.
  const pushOkRef = useRef<boolean | null>(null);
  if (pushOkRef.current === null) pushOkRef.current = isPushTransitionEnabled(preview);

  // Derived during render, NOT in an effect. What it produces decides how a
  // div keyed by activeKey mounts, in that very same commit, so an effect
  // resolves one render too late and lands on a transition that has already
  // started — a class arriving mid-slide makes the layer snap rather than
  // ease, and one arriving a frame late restarts a slide that was already
  // running. Both were visible on the wall as a "very odd" transition.
  const revealRef = useRef<{ key: string; enabled: boolean }>({ key: activeKey, enabled: false });
  if (revealRef.current.key !== activeKey) {
    revealRef.current = { key: activeKey, enabled: !!pushOkRef.current && !blanked };
  }

  // Two stacked layers: the outgoing content is carried off the top while the
  // incoming one rises from the bottom, and the incoming one does not start
  // moving until it can actually paint. Feeding `blanked` into `enabled` is the
  // whole of the blanking bypass — a push received while blanked lands as a cut
  // with no retained layer, and unblanking later cannot animate retroactively.
  const { incoming, outgoing, phase, markReady, incomingRef } = useContentTransition({
    content: activeContent,
    contentKey: activeKey,
    enabled: revealRef.current.enabled,
  });
  const staged = phase !== "idle";

  const handleContentUpdate = useCallback(
    (incoming: WsContent) => queueContent(incoming),
    [queueContent]
  );

  const handleCommand = useCallback((command: string, value?: any) => {
    // Commands a framed viewer owns are ALSO republished for HtmlRenderer to
    // relay into its iframe (a separate JS realm the branches below can't
    // reach). Deliberately not an `else if` — NEXT_PAGE/PREV_PAGE must keep
    // reaching ExperienceDisplay below as well. Replayable so a viewer whose
    // iframe is still loading catches up (see the bridge's ready handshake).
    if (isFrameForwardedCommand(command)) {
      dispatchReplayableEvent(frameCommandEvent(command), value);
    }

    if (command === "RELOAD") {
      window.location.reload();
    } else if (command === "MUTE" || command === "UNMUTE") {
      const event = new CustomEvent("screen-mute", {
        detail: { muted: command === "MUTE" },
      });
      window.dispatchEvent(event);
    } else if (command === "NEXT_PAGE" || command === "PREV_PAGE") {
      const event = new CustomEvent("screen-navigate", {
        detail: { direction: command === "NEXT_PAGE" ? "next" : "prev" },
      });
      window.dispatchEvent(event);
    } else if (command === MEDIA_SEEK) {
      // Transient like MUTE — a seek is an instruction to act now, not a
      // position to catch up to, so it deliberately isn't replayable.
      window.dispatchEvent(new CustomEvent(MEDIA_SEEK_EVENT, { detail: value }));
    } else if (command === MEDIA_SEEK_TO) {
      // Absolute, but transient for the same reason as MEDIA_SEEK above: it is
      // where a finger let go of the scrub bar just now, not a position later
      // joiners should be caught up to. The screen answers with SET_PLAYBACK,
      // which IS the replayable record.
      window.dispatchEvent(new CustomEvent(MEDIA_SEEK_TO_EVENT, { detail: value }));
    } else if (command === MEDIA_SET_PAUSED) {
      // Transient, like the seeks above: this is "pause because a drag is
      // starting", not a state later joiners should be caught up to. The
      // screen's own SET_PLAYBACK remains the replayable record.
      window.dispatchEvent(new CustomEvent(MEDIA_SET_PAUSED_EVENT, { detail: value }));
    } else if (command === MEDIA_TOGGLE_PLAY) {
      window.dispatchEvent(new CustomEvent(MEDIA_TOGGLE_PLAY_EVENT));
    } else if (command === SET_PLAYBACK) {
      // Replayable, unlike the two above: this is the absolute position the
      // gateway replays right after CONTENT_UPDATE when a video is re-pushed,
      // and it lands before VideoRenderer has mounted — see the comment on
      // SET_SLIDE below.
      dispatchReplayableEvent(MEDIA_SET_PLAYBACK_EVENT, value);
    } else if (command === "SET_SLIDE") {
      // Replayable: a late-joining client (e.g. the CMS mirror reconnecting)
      // can receive this before ExperienceDisplay's listener has mounted —
      // see replayable-window-event.ts.
      dispatchReplayableEvent("screen-set-slide", { slideIndex: Number(value) });
    } else if (command === "SET_PORTFOLIO_VIEW") {
      // Inbound portfolio view change from another client of this screen.
      // Replayable — see comment on SET_SLIDE above.
      dispatchReplayableEvent("portfolio-set-view", value);
    } else if (command === "SET_PORTFOLIO_VIDEO") {
      dispatchReplayableEvent("portfolio-set-video", value);
    } else if (command === "SET_GALLERY_VIEW") {
      // Which gallery photo is expanded — a tap on a control tablet has to open
      // the same photo on the wall. Replayable — see comment on SET_SLIDE above.
      dispatchReplayableEvent("gallery-set-view", value);
    } else if (command === "SET_FLIGHT_VIEW") {
      // Flight Garden's HUD — which visualization is showing, its airport, and
      // the weather feed driving the art. Replayable, and it matters more here
      // than for most: the engine chunk is a slow dynamic import, so a replayed
      // view routinely arrives before the canvas has mounted its listener.
      dispatchReplayableEvent("flight-set-view", value);
    } else if (command === DATA_ART_VIEW_COMMAND) {
      // Data Art Studio's landing choices (data source, art, Generate/back) from
      // another client of this screen. Replayable for the same reason as the
      // flight view: the studio is an iframe that loads well after the replay.
      dispatchReplayableEvent(DATA_ART_VIEW_EVENT, value);
    } else if (command === "SET_FILM_VIEW") {
      // Films page grid/player + which film — replayable, same reason as above.
      dispatchReplayableEvent("film-set-view", value);
    } else if (command === SET_VIDEO_PLAYBACK) {
      // Position and play state of the portfolio video that is open — the films
      // player or the overview's "Watch Video" popup. Replayable for the same
      // reason as SET_SLIDE: the gateway replays it right after CONTENT_UPDATE,
      // well before the <video> it belongs to has mounted, and the surface picks
      // it up on arrival instead of starting from zero.
      dispatchReplayableEvent(VIDEO_PLAYBACK_EVENT, value);
    } else if (command === "RESET_STATE" || command === "RESET_VIEW") {
      // Reset interactive templates & experiences back to their initial state (1st frame / overview)
      dispatchReplayableEvent("portfolio-set-view", {
        cardIndex: null,
        sectionIndex: null,
        projectIndex: null,
        splitView: false,
        cameFromSplit: false,
      });
      dispatchReplayableEvent("portfolio-set-video", { videoUrl: null });
      dispatchReplayableEvent("screen-set-slide", { slideIndex: 0 });
      dispatchReplayableEvent("gallery-set-view", { photoId: null, index: null });
      dispatchReplayableEvent("film-set-view", { mode: "grid", index: null });
      // Undefined, not a default view: the Flight Garden's own defaults live in
      // the engine (DEFAULT_SCENE / the authored airportCode), so clearing the
      // replay buffer lets a freshly-mounted scene use them rather than being
      // driven back to a guess made here.
      dispatchReplayableEvent("flight-set-view", undefined);
      // Undefined closes any open artwork and keeps the studio's picks.
      dispatchReplayableEvent(DATA_ART_VIEW_EVENT, undefined);
      // Null, not a position: the gateway drops its own cache on RESET_STATE,
      // but the replay buffer here is per-tab and would otherwise resume a film
      // at the position it was reset away from the next time one is opened.
      dispatchReplayableEvent(VIDEO_PLAYBACK_EVENT, null);
      window.dispatchEvent(new CustomEvent("screen-reset-state"));
    } else if (command === WHITEBOARD_START) {
      window.dispatchEvent(new CustomEvent("whiteboard-start"));
    } else if (command === WHITEBOARD_STOP) {
      window.dispatchEvent(new CustomEvent("whiteboard-stop"));
    } else if (command === WHITEBOARD_SYNC) {
      window.dispatchEvent(new CustomEvent("whiteboard-sync", { detail: value }));
    } else if (command === WHITEBOARD_SURFACE) {
      window.dispatchEvent(new CustomEvent("whiteboard-surface", { detail: value }));
    } else if (command === WHITEBOARD_SET_STYLE) {
      window.dispatchEvent(new CustomEvent("whiteboard-set-style", { detail: value }));
    } else if (command === WHITEBOARD_STROKE_BEGIN) {
      window.dispatchEvent(new CustomEvent("whiteboard-stroke-begin", { detail: value }));
    } else if (command === WHITEBOARD_STROKE_POINT) {
      window.dispatchEvent(new CustomEvent("whiteboard-stroke-point", { detail: value }));
    } else if (command === WHITEBOARD_STROKE_END) {
      window.dispatchEvent(new CustomEvent("whiteboard-stroke-end"));
    } else if (command === WHITEBOARD_UNDO) {
      window.dispatchEvent(new CustomEvent("whiteboard-undo"));
    } else if (command === WHITEBOARD_CLEAR) {
      window.dispatchEvent(new CustomEvent("whiteboard-clear"));
    } else if (command === "SCREEN_BLANK") {
      window.dispatchEvent(new CustomEvent("screen-blank"));
    } else if (command === "SCREEN_UNBLANK") {
      window.dispatchEvent(new CustomEvent("screen-unblank"));
    } else if (command === "EXIT_FULLSCREEN" && !preview) {
      // Remote escape hatch (5-tap on a CMS mirror). Ignored by mirrors so the
      // gateway's echo-to-sender doesn't drop the operator's own tab out of
      // fullscreen too. exitFullscreen needs no user gesture; requestFullscreen
      // does, which is why there's no remote "enter".
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    } else if (command === "APP_MINIMIZE" && !preview) {
      // Only meaningful on the real TV, running inside the LobbyKiosk WebView2
      // host — a no-op in a regular browser tab, and ignored by CMS mirrors so
      // the operator's own tab doesn't minimize.
      window.chrome?.webview?.postMessage("minimize");
    } else if (command === "APP_MAXIMIZE" && !preview) {
      window.chrome?.webview?.postMessage("maximize");
    } else if (command === "APP_CLOSE" && !preview) {
      window.chrome?.webview?.postMessage("close");
    }
  }, [preview]);

  // ponytail: sendRaw was only used by the (now-disconnected) browser detection
  // hook to emit CAMERA_/PRODUCT_ events. Restore it here when re-enabling.
  const { status, sendInteraction } = useScreenWebSocket({
    screenId,
    onContentUpdate: handleContentUpdate,
    onCommand: handleCommand,
    wsUrl,
    preview,
  });

  // Five taps in the top-left corner: on the TV, toggle fullscreen locally; on
  // a CMS mirror, relay it so the TV exits instead of the operator's own tab.
  const handleFiveTaps = useCallback(() => {
    if (preview) {
      sendInteraction("EXIT_FULLSCREEN");
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      // ponytail: only exits fullscreen this page entered itself. F11 browser
      // fullscreen and `msedge --kiosk` are invisible to JS — launch the
      // display windowed and let this gesture own fullscreen instead.
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, [preview, sendInteraction]);

  const [debugMode, setDebugMode] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setDebugMode(params.get("visionDebug") === "1");
    }
  }, []);

  // Pause detection only during an actual detection takeover (showcase with a
  // resolved product). A showcase template with an empty productId is authored
  // idle content — detection must keep running over it.
  const showcaseContent = activeContent?.templateContent?.["product-showcase"] as
    | { productId?: string; cameraId?: string }
    | undefined;
  const isShowcase =
    activeContent?.templateKey === "product-showcase" && !!showcaseContent?.productId;
  // A product-showcase experience can pin a specific physical camera; otherwise
  // fall back to the screen's default camera mapping.
  const effectiveCameraId =
    (activeContent?.templateKey === "product-showcase" && showcaseContent?.cameraId) ||
    SCREEN_TO_CAMERA[screenId];
  const hasMappedCamera = Boolean(effectiveCameraId);
  // Detection only ever auto-starts on the real TV route for mapped screens.
  // CMS embeds/previews never touch the camera, so browsing the dashboard
  // can't grab the operator's own webcam.
  // ponytail: browser detection disconnected — the GPU-box vision service
  // (services/vision) owns the cameras now, so the hook that grabbed the
  // operator's webcam is commented out and replaced by a disabled stub. No
  // camera is ever accessed. The old browser-side hook has been removed; see
  // git history for apps/cms/src/hooks/useServerDetection.ts if it is ever needed.
  const runServer = !preview && !isShowcase && hasMappedCamera;

  const serverDetection = {
    stream: null as MediaStream | null,
    lastResult: null,
    status: "disconnected" as const,
    cameraId: effectiveCameraId ?? null,
    stats: { rttMs: 0, processingTimeMs: 0 },
  };

  // Content dispatches a `screen-control` event when the user interacts (touch/
  // click). Relay it over WS so every client of this screen (the TV and any CMS
  // mirror) applies the same navigation — keeping the page identical everywhere.
  useEffect(() => {
    const onControl = (e: Event) => {
      const { command, value } = (e as CustomEvent<{ command: string; value?: unknown }>).detail;
      if (command) sendInteraction(command, value);
    };
    window.addEventListener("screen-control", onControl);
    return () => window.removeEventListener("screen-control", onControl);
  }, [sendInteraction]);

  // On every (re)connect, sync to the authoritative current content from
  // screens.json. Covers API restarts (in-memory cache wiped) and broadcasts
  // missed during a reconnect gap. queueContent dedups by content key, so this
  // is a no-op when the screen is already current.
  useEffect(() => {
    if (status !== "connected") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/screens/${screenId}/config`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.content) queueContent(data.content as WsContent);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [status, screenId, queueContent]);

  // HTTP fallback: poll every 5s while WS is disconnected
  useEffect(() => {
    if (status !== "disconnected") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/screens/${screenId}/config`);
        if (res.ok) {
          const data = await res.json();
          if (data.content) queueContent(data.content as WsContent);
        }
      } catch { /* silent */ }
    }, 5_000);
    return () => clearInterval(interval);
  }, [status, screenId, queueContent]);

  const displayContent = toDisplayContent(incoming.content);

  /**
   * The display page pins `touch-action: none` on html/body so signage can't be
   * panned or pinch-zoomed by a passer-by. Touch-action is intersected down the
   * ancestor chain and that chain crosses into an iframe, so leaving it set
   * would mean a touch screen could tap inside an embedded page but never
   * scroll it. Relaxed only while a page is on screen.
   *
   * Owned here rather than in HtmlRenderer, which used to save the value on
   * mount and restore it on unmount: with two layers mounted at once that
   * ordering inverts (the incoming frame saves the outgoing frame's "auto",
   * then the outgoing unmounts and restores "none"), leaving a pushed PDF or
   * sheet on screen that no longer scrolls. Deriving from the active content
   * type has no ordering to get wrong. "" falls back to the page's own inline
   * touch-action: none, so non-html behaves exactly as before.
   */
  useEffect(() => {
    const relax = displayContent.type === "html";
    document.documentElement.style.touchAction = relax ? "auto" : "";
    document.body.style.touchAction = relax ? "auto" : "";
  }, [displayContent.type]);

  // IdleDisplay is picked here rather than inside ContentRenderer, so it is the
  // one incoming layer with no renderer to report on its behalf. It paints as
  // soon as it commits; without this, going idle would sit out the transition's
  // full ready timeout before moving.
  const incomingIsIdle = incoming.content.id === "__idle__";
  useEffect(() => {
    if (incomingIsIdle) markReady(incoming.key);
  }, [incomingIsIdle, incoming.key, markReady]);

  const renderLayer = (layer: ContentLayer, role: { staged?: boolean; outgoing?: boolean }) =>
    layer.content.id === "__idle__" ? (
      <IdleDisplay screenId={screenId} />
    ) : (
      <ContentRenderer
        content={toDisplayContent(layer.content)}
        screenId={screenId}
        preview={preview}
        staged={role.staged}
        outgoing={role.outgoing}
        onReady={role.outgoing ? undefined : () => markReady(layer.key)}
      />
    );

  // ONE keyed array, not two JSX slots. The outgoing layer is the same subtree
  // that was the incoming one a moment ago, and React only carries a subtree
  // across by key WITHIN a single array — as two static slots it would unmount
  // and remount instead, so the content being pushed off the top would restart
  // from zero (and re-download) as it slid away.
  const layers: { layer: ContentLayer; outgoing: boolean }[] = [];
  if (outgoing) layers.push({ layer: outgoing, outgoing: true });
  layers.push({ layer: incoming, outgoing: false });

  return (
    <>
      {layers.map(({ layer, outgoing: isOutgoing }) => (
        <div
          key={layer.key}
          ref={isOutgoing ? undefined : incomingRef}
          className={cn(
            "screen-layer",
            isOutgoing ? "screen-layer--out" : staged && "screen-layer--in",
            phase === "running" && "screen-layer--running"
          )}
        >
          {!blanked && renderLayer(layer, isOutgoing ? { outgoing: true } : { staged })}
        </div>
      ))}
      <WhiteboardScreenOverlay sendInteraction={sendInteraction} />
      <BlackoutOverlay />
      {/* Only the html renderer puts content in a cross-origin iframe, where a
          document listener would never see the taps. */}
      <FiveTapCorner onTrigger={handleFiveTaps} overlay={displayContent.type === "html"} />
      {runServer && debugMode && (
        <DetectionDebugOverlay
          stream={serverDetection.stream}
          lastResult={serverDetection.lastResult}
          status={serverDetection.status}
          cameraId={serverDetection.cameraId}
          stats={serverDetection.stats}
        />
      )}
    </>
  );
}
