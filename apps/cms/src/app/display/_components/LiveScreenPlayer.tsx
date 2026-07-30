"use client";

import { useCallback, useEffect, useState } from "react";
import type { WsContent } from "@platform/types";
import type { Content } from "@/types/display";
import { useScreenWebSocket } from "@/hooks/useScreenWebSocket";
import { useContentPreloader } from "@/hooks/useContentPreloader";
// ponytail: browser-based detection is disconnected — cameras are now
// host-native on the GPU box (services/vision). The hook + @platform/vision-browser
// are left in place; re-enable the call below to restore browser detection.
// import { useServerDetection } from "@/hooks/useServerDetection";
import { SCREEN_TO_CAMERA } from "@/lib/display/camera-config";
import { DetectionDebugOverlay } from "./DetectionDebugOverlay";
import { ContentRenderer } from "./ContentRenderer";
import { WhiteboardScreenOverlay } from "./WhiteboardScreenOverlay";
import { BlackoutOverlay } from "./BlackoutOverlay";
import { FiveTapCorner } from "./FiveTapCorner";
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

// Sentinel used when screen has no content assigned yet
const IDLE_WS_CONTENT: WsContent = {
  id: "__idle__",
  type: "video",
  source: "/media/4k_render_intro_animation_0003.mp4",
  loop: true,
  muted: true,
};

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
      return { id: ws.id, type: "video", source: ws.source, loop: ws.loop ?? true, muted: ws.muted ?? true };
    case "image":
      return { id: ws.id, type: "image", source: ws.source };
    case "html":
      return { id: ws.id, type: "html", source: ws.source };
    case "webpage":
      return { id: ws.id, type: "webpage", source: ws.source };
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


  const handleContentUpdate = useCallback(
    (incoming: WsContent) => queueContent(incoming),
    [queueContent]
  );

  const handleCommand = useCallback((command: string, value?: any) => {
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
    } else if (command === "SET_SLIDE") {
      const event = new CustomEvent("screen-set-slide", {
        detail: { slideIndex: Number(value) },
      });
      window.dispatchEvent(event);
    } else if (command === "SET_PORTFOLIO_VIEW") {
      // Inbound portfolio view change from another client of this screen.
      window.dispatchEvent(new CustomEvent("portfolio-set-view", { detail: value }));
    } else if (command === "SET_PORTFOLIO_VIDEO") {
      window.dispatchEvent(new CustomEvent("portfolio-set-video", { detail: value }));
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
  // camera is ever accessed. Restore by uncommenting the import + hook call.
  const runServer = !preview && !isShowcase && hasMappedCamera;

  // const serverDetection = useServerDetection({
  //   screenId,
  //   sendRaw,
  //   enabled: runServer,
  //   cameraId: effectiveCameraId,
  // });
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

  const displayContent = toDisplayContent(activeContent);

  return (
    <>
      <div key={activeKey} className="screen-content-fade">
        <ContentRenderer content={displayContent} screenId={screenId} preview={preview} />
      </div>
      <WhiteboardScreenOverlay sendInteraction={sendInteraction} />
      <BlackoutOverlay />
      <FiveTapCorner onTrigger={handleFiveTaps} />
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
