"use client";

import { useCallback, useEffect, useState } from "react";
import type { CameraStatusUpdate, WsContent } from "@platform/types";
import type { Content } from "@/types/display";
import { useScreenWebSocket } from "@/hooks/useScreenWebSocket";
import { useContentPreloader } from "@/hooks/useContentPreloader";
import { ContentRenderer } from "./ContentRenderer";
import { ContentPickerOverlay } from "./ContentPickerOverlay";
import { ContentTitleOverlay } from "./ContentTitleOverlay";
import { CameraStatusOverlay } from "./CameraStatusOverlay";

interface LiveScreenPlayerProps {
  screenId: string;
  initialContent: Content | null;
  wsUrl: string;
  apiUrl: string;
  pickerEnabled?: boolean;
  /** Registers as a preview mirror (CMS embed): no picker, excluded from online count. */
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
  apiUrl,
  pickerEnabled = true,
  preview = false,
}: LiveScreenPlayerProps) {
  const initial = initialContent ? toWsContent(initialContent) : IDLE_WS_CONTENT;
  const { activeContent, queueContent } = useContentPreloader(initial);
  const [cameraStatus, setCameraStatus] = useState<CameraStatusUpdate | null>(null);

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
    }
  }, []);

  const { status, sendContentChangeRequest, sendInteraction } = useScreenWebSocket({
    screenId,
    onContentUpdate: handleContentUpdate,
    onCameraStatusUpdate: setCameraStatus,
    onCommand: handleCommand,
    wsUrl,
    preview,
  });

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
        const res = await fetch(`/api/config/${screenId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.content) queueContent(data.content as WsContent);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [status, screenId, queueContent]);

  // HTTP fallback: poll local screens.json every 5s while WS is disconnected
  useEffect(() => {
    if (status !== "disconnected") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/config/${screenId}`);
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
      <ContentRenderer content={displayContent} screenId={screenId} />
      {activeContent.title && <ContentTitleOverlay title={activeContent.title} />}
      <CameraStatusOverlay status={cameraStatus} />
      {pickerEnabled && (
        <ContentPickerOverlay
          apiUrl={apiUrl}
          onSelect={(content) => {
            queueContent(content);
            sendContentChangeRequest(content);
          }}
        />
      )}
    </>
  );
}
